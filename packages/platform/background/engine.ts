// The background engine (ADR 0025): jobs stored in `platform_jobs`, run in two lanes, short and maintenance, one
// job at a time per lane and both lanes at once. Claiming a job moves it from pending to running in one
// transaction of the one connection, so two claims never take the same job. Each job gets a cancellation signal,
// aborted when its maximum time runs out; one that does not end within a margin after that is stuck, and its
// lane stays taken until it ends. A permanent error fails at once; a passing one, timing out included, is retried
// with a growing wait up to a maximum of attempts, never before the instant it may ask for. A job of the outbox
// (ADR 0029) carries its data, which its kind's schema checks when it is claimed, and the log entry of the write
// that left it, whose undo cancels it while pending. What a previous process left running is recovered at start.
// The engine sets no timer of its own: whoever drives it calls `pump` when `nextDue` says, and stopping waits
// through the platform's timer.
import type { AnySchema } from "@orpc/contract";
import type Database from "better-sqlite3";

import type { Clock } from "../actions";
import { errorCode } from "../error-code";
import type { jobs } from "../schema";
import type { Timer } from "./timer";

export type Lane = "short" | "maintenance";

/** The maximum time of a job whose kind declares none, by lane. Initial values, revised when measured. */
export const LANE_TIMEOUT: Readonly<Record<Lane, number>> = {
	short: 30 * 1000,
	maintenance: 30 * 60 * 1000,
};
/** How long a job may go on after its maximum time cancelled it before it counts as stuck. */
export const STUCK_MARGIN = 10 * 1000;
/** How long stopping waits for the cancelled jobs: under Docker's 10 s before it kills the container. */
export const STOP_MARGIN = 5 * 1000;
/** The attempts of a job, the first included, before a passing error leaves it failed. */
export const MAX_ATTEMPTS = 5;
/** The wait before the first retry; each next one doubles it. */
export const FIRST_RETRY = 30 * 1000;
/** The longest error a job's row keeps. */
const MAX_ERROR = 200;

/**
 * What a job's work receives: its cancellation signal, checked between steps, the instant it started and its data,
 * as its kind's schema gave it back (undefined for a kind without one).
 */
export interface JobContext {
	readonly signal: AbortSignal;
	readonly startedAt: number;
	readonly payload: unknown;
}

/**
 * What a job's work ends with: nothing for plain "done", or the outcome its row keeps when "done" is not all, such
 * as a notice skipped and why. Written by platform code, without personal data.
 */
export type JobResult = string | undefined;

/** A kind of job: the lane it runs in, its maximum time if not its lane's, the schema of its data and its work. */
export interface JobKind {
	readonly lane: Lane;
	/** Milliseconds from its start until its signal is aborted. Unset: {@link LANE_TIMEOUT} of its lane. */
	readonly timeout?: number;
	/**
	 * The schema of the data its jobs carry, checked synchronously when one is claimed: data that does not match fails
	 * the job for good with {@link INVALID_PAYLOAD}. Unset: its jobs carry none.
	 */
	readonly payload?: AnySchema;
	run(context: JobContext): Promise<JobResult | void> | JobResult | void;
	/**
	 * Runs inside the transaction that records the job's end for good when it failed: at once for a permanent error,
	 * or once a passing error used up its attempts. Not for a job that stopping cancelled.
	 */
	failed?(at: number): void;
}

/**
 * An error a job marks as permanent: retrying cannot help, so the job fails at once. Its message is kept for
 * whoever operates the system, so it is written in English by platform code and carries no personal data.
 */
export class PermanentJobError extends Error {
	override readonly name = "PermanentJobError";
	/** A fixed code of the failure, such as {@link INVALID_PAYLOAD}, kept before its message. */
	readonly code: string | undefined;

	constructor(message: string, options: { readonly code?: string } = {}) {
		super(message);
		this.code = options.code;
	}
}

/**
 * A passing error that names the earliest instant of the next attempt, such as a service that asks to wait: the
 * retry goes at the later of that instant and the growing wait, within the same maximum of attempts. As with any
 * passing error, its row keeps only its name and code.
 */
export class PassingJobError extends Error {
	override readonly name = "PassingJobError";
	readonly code: string | undefined;
	/** The earliest instant, on the platform clock, of the next attempt. */
	readonly notBefore: number | undefined;

	constructor(
		message: string,
		options: { readonly code?: string; readonly notBefore?: number } = {},
	) {
		super(message);
		this.code = options.code;
		this.notBefore = options.notBefore;
	}
}

/** The code of a job whose data does not match the schema of its kind, or that carries data its kind takes none of. */
export const INVALID_PAYLOAD = "INVALID_PAYLOAD";

/** Why the undo of its entry cancelled a job of the outbox. */
export const UNDONE = "undone";

/**
 * A job to store: its kind, the instant from which it may run, for a scheduled run that run's id and, for a job of
 * the outbox, its data, which must survive JSON, and the log entry of the write that left it.
 */
export interface NewJob {
	readonly kind: string;
	readonly runAt: number;
	readonly taskRun?: number;
	readonly payload?: unknown;
	readonly entry?: number;
}

/** How a job ended for good. `cancelled` when it failed after stopping the engine aborted its signal. */
export type JobOutcome =
	| { readonly state: "done"; readonly outcome?: string }
	| { readonly state: "failed" | "cancelled"; readonly error: string };

/** A job as it ends for good, for whoever records what it belonged to. */
export interface FinishedJob {
	readonly id: number;
	readonly kind: string;
	readonly taskRun: number | null;
	/** When its first attempt started. */
	readonly startedAt: number;
	readonly finishedAt: number;
	readonly outcome: JobOutcome;
}

/** A job as its row keeps it, for the testing entry. */
export interface JobSnapshot {
	readonly id: number;
	readonly kind: string;
	readonly lane: Lane;
	/** The states `platform_jobs` admits. */
	readonly state: (typeof jobs.$inferSelect)["state"];
	readonly attempts: number;
	readonly runAt: number;
	readonly error: string | null;
	/** Its data, parsed from its JSON; null for a job without any. */
	readonly payload: unknown;
	/** The log entry of the write that left it; null for a job no write left. */
	readonly entry: number | null;
	readonly outcome: string | null;
}

export interface EngineOptions {
	readonly connection: Database.Database;
	readonly clock: Clock;
	/** How stopping waits, at most {@link STOP_MARGIN}, for the jobs it cancelled. */
	readonly timer: Timer;
	readonly kinds: ReadonlyMap<string, JobKind>;
	/**
	 * Runs inside the transaction that claims a job of a task run, with the start of its first attempt: the run
	 * shows it has started while its job runs, waits for a retry or is stuck.
	 */
	readonly onStart?: (taskRun: number, startedAt: number) => void;
	/** Runs inside the transaction that records a job's end for good: what the job belonged to ends with it. */
	readonly onFinish?: (job: FinishedJob) => void;
	/** Called after a job ended and its end was recorded: a lane is free, so something may be due. */
	readonly onIdle?: () => void;
}

export interface Engine {
	/** Stores a pending job and returns its id. Joins the caller's transaction when there is one. */
	enqueue(job: NewJob): number;
	/**
	 * Cancels for good, inside the caller's transaction, every job of `entry` still pending, with the reason
	 * {@link UNDONE}; one already claimed goes on. Returns how many it cancelled.
	 */
	cancelPendingOf(entry: number): number;
	/**
	 * Back to pending, its interrupted attempt counted, each job a previous process left running or stuck; failed
	 * if that was its last attempt. Returns how many it recovered. Before the first `pump`.
	 */
	recover(): number;
	/**
	 * On each lane: cancels the running job whose maximum time ran out, marks stuck the one that did not end
	 * within the margin after that, and on a free lane claims and starts the next job due. Nothing once stopped.
	 */
	pump(): void;
	/** The earliest instant after now when `pump` has something to do: a pending job, a maximum time, a margin. */
	nextDue(): number | undefined;
	/** The jobs started and not yet recorded as ended, each settling once its end is recorded. */
	inFlight(): readonly Promise<void>[];
	/** True while a lane holds a stuck job: one that went on past the margin after its cancellation. */
	stuck(): boolean;
	/**
	 * Stops claiming, aborts the signal of every running job and waits, at most {@link STOP_MARGIN}, until each
	 * one ended. A job that did not end stays running in the database, and the next start recovers it.
	 */
	stop(): Promise<void>;
}

interface JobRow {
	readonly id: number;
	readonly kind: string;
	readonly lane: Lane;
	readonly task_run: number | null;
	readonly attempts: number;
	readonly started_at: number | null;
	readonly payload: string | null;
}

/** A job on its lane. */
interface Running {
	readonly row: JobRow;
	readonly abort: AbortController;
	readonly done: Promise<void>;
	readonly deadline: number;
	/** When its maximum time aborted its signal. */
	cancelledAt?: number;
	stuck: boolean;
}

/** Why a signal was aborted. */
const TIMED_OUT = "timed out";
const STOPPING = "stopping";

const LANES: readonly Lane[] = ["short", "maintenance"];

export function createEngine({
	connection,
	clock,
	timer,
	kinds,
	onStart,
	onFinish,
	onIdle,
}: EngineOptions): Engine {
	const insert = connection.prepare(
		`INSERT INTO platform_jobs (kind, lane, state, run_at, task_run, payload, entry, created_at)
			VALUES (?, ?, 'pending', ?, ?, ?, ?, ?)`,
	);
	const selectDue = connection.prepare(
		`SELECT id, kind, lane, task_run, attempts, started_at, payload FROM platform_jobs
			WHERE lane = ? AND state = 'pending' AND run_at <= ? ORDER BY run_at, id LIMIT 1`,
	);
	// A job keeps the start of its first attempt.
	const markRunning = connection.prepare(
		`UPDATE platform_jobs SET state = 'running', started_at = coalesce(started_at, ?),
			attempts = attempts + 1 WHERE id = ? AND state = 'pending'`,
	);
	const selectNextDue = connection
		.prepare("SELECT min(run_at) FROM platform_jobs WHERE state = 'pending' AND run_at > ?")
		.pluck();
	const markEnded = connection.prepare(
		"UPDATE platform_jobs SET state = ?, finished_at = ?, error = ?, outcome = ? WHERE id = ?",
	);
	// Claiming checks `state = 'pending'` too, so of a claim and a cancellation only one changes the row.
	const cancelOfEntry = connection.prepare(
		`UPDATE platform_jobs SET state = 'cancelled', finished_at = ?, error = ?
			WHERE entry = ? AND state = 'pending'`,
	);
	const markRetry = connection.prepare(
		"UPDATE platform_jobs SET state = 'pending', run_at = ?, error = ? WHERE id = ?",
	);
	const markStuck = connection.prepare(
		"UPDATE platform_jobs SET state = 'stuck' WHERE id = ? AND state = 'running'",
	);
	const selectInterrupted = connection.prepare(
		`SELECT id, kind, lane, task_run, attempts, started_at, payload FROM platform_jobs
			WHERE state IN ('running', 'stuck') ORDER BY id`,
	);

	const running = new Map<Lane, Running>();
	let stopped = false;

	const claim = connection.transaction((lane: Lane, now: number): JobRow | undefined => {
		const row = selectDue.get(lane, now) as JobRow | undefined;
		if (!row || markRunning.run(now, row.id).changes !== 1) return undefined;
		const startedAt = row.started_at ?? now;
		if (row.task_run !== null) onStart?.(row.task_run, startedAt);
		return { ...row, attempts: row.attempts + 1, started_at: startedAt };
	});

	/** Records a job's end: pending again for a retry, or its end for good with what it belonged to. */
	const record = connection.transaction((row: JobRow, end: End, finishedAt: number) => {
		if (end.state === "retry") {
			markRetry.run(end.retryAt, end.error, row.id);
			return;
		}
		const error = end.state === "done" ? null : end.error;
		const outcome = end.state === "done" ? (end.outcome ?? null) : null;
		markEnded.run(end.state, finishedAt, error, outcome, row.id);
		if (end.state === "failed") kinds.get(row.kind)?.failed?.(finishedAt);
		onFinish?.({
			id: row.id,
			kind: row.kind,
			taskRun: row.task_run,
			startedAt: row.started_at ?? finishedAt,
			finishedAt,
			outcome: end,
		});
	});

	const recover = connection.transaction((now: number): number => {
		const rows = selectInterrupted.all() as JobRow[];
		// The restart was the wait: a recovered job may run at once.
		for (const row of rows) {
			const end = afterPassingError(row, INTERRUPTED, now);
			record(row, end.state === "retry" ? { ...end, retryAt: now } : end, now);
		}
		return rows.length;
	});

	function start(lane: Lane, row: JobRow, startedAt: number): void {
		const abort = new AbortController();
		const kind = kinds.get(row.kind);
		const timeout = kind?.timeout ?? LANE_TIMEOUT[lane];
		const done = Promise.resolve()
			.then(() => {
				if (!kind) throw new PermanentJobError(undeclared(row.kind));
				return kind.run({ signal: abort.signal, startedAt, payload: payloadOf(kind, row) });
			})
			.then(
				(result): End =>
					typeof result === "string"
						? { state: "done", outcome: result }
						: { state: "done" },
				(error: unknown): End => {
					const now = clock();
					if (abort.signal.reason === STOPPING)
						return { state: "cancelled", error: messageOf(error) };
					if (abort.signal.reason === TIMED_OUT)
						return afterPassingError(row, `timed out after ${timeout} ms`, now);
					if (error instanceof PermanentJobError)
						return { state: "failed", error: messageOf(error) };
					const notBefore =
						error instanceof PassingJobError ? error.notBefore : undefined;
					return afterPassingError(row, messageOf(error), now, notBefore);
				},
			)
			.then((end) => {
				// Stopping gave up on it: its row stays running, for the next start to recover.
				if (running.get(lane)?.done !== done) return;
				record(row, end, clock());
				running.delete(lane);
				onIdle?.();
			});
		running.set(lane, { row, abort, done, deadline: startedAt + timeout, stuck: false });
	}

	/** Cancels a job whose maximum time ran out, and marks stuck one that went on past the margin. */
	function watch(job: Running, now: number): void {
		if (job.cancelledAt === undefined) {
			if (now < job.deadline) return;
			job.cancelledAt = now;
			job.abort.abort(TIMED_OUT);
		} else if (!job.stuck && now >= job.cancelledAt + STUCK_MARGIN) {
			job.stuck = true;
			markStuck.run(job.row.id);
		}
	}

	return {
		enqueue: (job) =>
			Number(
				insert.run(
					job.kind,
					laneOf(kinds, job.kind),
					job.runAt,
					job.taskRun ?? null,
					storedPayload(kinds, job),
					job.entry ?? null,
					clock(),
				).lastInsertRowid,
			),

		cancelPendingOf: (entry) => cancelOfEntry.run(clock(), UNDONE, entry).changes,

		recover: () => recover(clock()),

		pump() {
			if (stopped) return;
			for (const lane of LANES) {
				const now = clock();
				const job = running.get(lane);
				if (job) {
					watch(job, now);
					continue;
				}
				const row = claim(lane, now);
				if (row) start(lane, row, now);
			}
		},

		nextDue() {
			const now = clock();
			const instants = [...running.values()].flatMap((job) => {
				if (job.cancelledAt === undefined) return [job.deadline];
				return job.stuck ? [] : [job.cancelledAt + STUCK_MARGIN];
			});
			const pending = selectNextDue.get(now) as number | null;
			if (pending !== null) instants.push(pending);
			const later = instants.filter((instant) => instant > now);
			return later.length === 0 ? undefined : Math.min(...later);
		},

		inFlight: () => [...running.values()].map(({ done }) => done),

		stuck: () => [...running.values()].some((job) => job.stuck),

		async stop() {
			stopped = true;
			const jobs = [...running.values()];
			if (jobs.length === 0) return;
			for (const { abort } of jobs) abort.abort(STOPPING);
			await new Promise<void>((resolve) => {
				const cancel = timer.at(clock() + STOP_MARGIN, resolve);
				void Promise.all(jobs.map(({ done }) => done)).then(() => {
					cancel();
					resolve();
				});
			});
			running.clear();
		},
	};
}

/** What the end of an attempt leaves: its end for good, or pending again from an instant. */
type End =
	| JobOutcome
	| { readonly state: "retry"; readonly retryAt: number; readonly error: string };

/** What the operator reads of a job a previous process left running. */
const INTERRUPTED = "interrupted: the process ended while the job ran";

/**
 * After a passing error: retried after a wait that doubles from {@link FIRST_RETRY}, or at `notBefore` when that is
 * later; failed at the maximum of attempts either way.
 */
function afterPassingError(row: JobRow, error: string, now: number, notBefore?: number): End {
	if (row.attempts >= MAX_ATTEMPTS) return { state: "failed", error };
	const backoff = now + FIRST_RETRY * 2 ** (row.attempts - 1);
	return { state: "retry", retryAt: Math.max(backoff, notBefore ?? backoff), error };
}

/** The JSON a new job keeps of its data; a kind without a schema takes none. */
function storedPayload(kinds: ReadonlyMap<string, JobKind>, job: NewJob): string | null {
	if (job.payload === undefined) return null;
	if (!kinds.get(job.kind)?.payload)
		throw new Error(`the job kind "${job.kind}" declares no schema for its data`);
	return JSON.stringify(job.payload);
}

/**
 * A claimed job's data as its kind's schema gives it back, checked synchronously. Data that does not match, data of
 * a kind without a schema, or a schema that answers later fails the job for good with {@link INVALID_PAYLOAD}.
 */
function payloadOf(kind: JobKind, row: JobRow): unknown {
	const invalid = () =>
		new PermanentJobError(`the data of the job does not match the schema of "${row.kind}"`, {
			code: INVALID_PAYLOAD,
		});
	if (!kind.payload) {
		if (row.payload !== null) throw invalid();
		return undefined;
	}
	let value: unknown;
	try {
		value = row.payload === null ? undefined : JSON.parse(row.payload);
	} catch {
		throw invalid();
	}
	const result = kind.payload["~standard"].validate(value);
	if (result instanceof Promise) {
		result.catch(() => {});
		throw invalid();
	}
	if (result.issues) throw invalid();
	return result.value;
}

/** The message of a job of a kind nobody declared. */
function undeclared(kind: string): string {
	return `no job kind "${kind}" is declared`;
}

function laneOf(kinds: ReadonlyMap<string, JobKind>, kind: string): Lane {
	const found = kinds.get(kind);
	if (!found) throw new Error(undeclared(kind));
	return found.lane;
}

/**
 * What a failed job leaves in its row, for whoever operates the system, without personal data: the error's name
 * and, when it has one, its code, such as `SQLITE_BUSY`. Only a {@link PermanentJobError}, written by platform
 * code, keeps its message: any other message may quote the data it failed on.
 */
function messageOf(error: unknown): string {
	if (!(error instanceof Error)) return "a non-Error value was thrown";
	const code = errorCode(error);
	const named = code === undefined ? error.name : `${error.name} ${code}`;
	if (error instanceof PermanentJobError) return `${named}: ${error.message}`.slice(0, MAX_ERROR);
	return named.slice(0, MAX_ERROR);
}

/**
 * Cancels for good every job pending, running or stuck, with `error`, and ends the run of a task each one belonged
 * to as cancelled with the same error, inside the caller's transaction: nothing of it runs, nor is recovered at
 * start. Restoring does it, so a copy repeats no notice or effect that already went out.
 */
export function discardUnfinishedJobs(
	connection: Database.Database,
	now: number,
	error: string,
): void {
	connection
		.prepare(
			`UPDATE platform_task_runs SET finished_at = ?, result = 'cancelled', error = ?
				WHERE result IS NULL AND id IN (SELECT task_run FROM platform_jobs
					WHERE state IN ('pending', 'running', 'stuck') AND task_run IS NOT NULL)`,
		)
		.run(now, error);
	connection
		.prepare(
			`UPDATE platform_jobs SET state = 'cancelled', finished_at = ?, error = ?
				WHERE state IN ('pending', 'running', 'stuck')`,
		)
		.run(now, error);
}

/** Every job, oldest first. */
export function readJobs(connection: Database.Database): readonly JobSnapshot[] {
	return connection
		.prepare<[], JobSnapshot>(
			`SELECT id, kind, lane, state, attempts, run_at AS runAt, error, payload, entry, outcome
				FROM platform_jobs ORDER BY id`,
		)
		.all()
		.map((job) => ({
			...job,
			payload: typeof job.payload === "string" ? JSON.parse(job.payload) : null,
		}));
}

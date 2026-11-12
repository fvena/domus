// The background engine (ADR 0025): jobs stored in `platform_jobs`, run in lanes, one job at a time per lane.
// Claiming a job moves it from pending to running in one transaction of the one connection, so two claims never
// take the same job. Each job gets a cancellation signal; stopping the engine stops claiming, aborts what runs and
// waits for it to end. The engine never sets a timer: whoever drives it calls `pump` when something may be due.
import type Database from "better-sqlite3";

import type { Clock } from "../actions";

export type Lane = "short" | "maintenance";

/** What a job's work receives: its cancellation signal, checked between steps, and the instant it started. */
export interface JobContext {
	readonly signal: AbortSignal;
	readonly startedAt: number;
}

/** A kind of job: the lane it runs in and its work. */
export interface JobKind {
	readonly lane: Lane;
	run(context: JobContext): Promise<void> | void;
}

/** A job to store: its kind, the instant from which it may run and, for a scheduled run, that run's id. */
export interface NewJob {
	readonly kind: string;
	readonly runAt: number;
	readonly taskRun?: number;
}

/** How a job ended. `cancelled` when it failed after its signal was aborted. */
export type JobOutcome =
	| { readonly state: "done" }
	| { readonly state: "failed" | "cancelled"; readonly error: string };

/** A job as it ends, for whoever records what it belonged to. */
export interface FinishedJob {
	readonly id: number;
	readonly kind: string;
	readonly taskRun: number | null;
	readonly startedAt: number;
	readonly finishedAt: number;
	readonly outcome: JobOutcome;
}

export interface EngineOptions {
	readonly connection: Database.Database;
	readonly clock: Clock;
	readonly kinds: ReadonlyMap<string, JobKind>;
	/** Runs inside the transaction that records a job's end: what the job belonged to ends with it. */
	readonly onFinish?: (job: FinishedJob) => void;
	/** Called after a job ended and its end was recorded: a lane is free, so something may be due. */
	readonly onIdle?: () => void;
}

export interface Engine {
	/** Stores a pending job and returns its id. Joins the caller's transaction when there is one. */
	enqueue(job: NewJob): number;
	/** Claims and starts, on each free lane, the next job due by the clock. Does nothing once stopped. */
	pump(): void;
	/** The earliest instant after now when a pending job may run; those already due wait for a free lane. */
	nextDue(): number | undefined;
	/** The jobs started and not yet recorded as ended, each settling once its end is recorded. */
	inFlight(): readonly Promise<void>[];
	/** Stops claiming, aborts the signal of every running job and waits until each one ended. */
	stop(): Promise<void>;
}

interface JobRow {
	readonly id: number;
	readonly kind: string;
	readonly lane: Lane;
	readonly task_run: number | null;
}

const LANES: readonly Lane[] = ["short", "maintenance"];

export function createEngine({
	connection,
	clock,
	kinds,
	onFinish,
	onIdle,
}: EngineOptions): Engine {
	const insert = connection.prepare(
		`INSERT INTO platform_jobs (kind, lane, state, run_at, task_run, created_at)
			VALUES (?, ?, 'pending', ?, ?, ?)`,
	);
	const selectDue = connection.prepare(
		`SELECT id, kind, lane, task_run FROM platform_jobs
			WHERE lane = ? AND state = 'pending' AND run_at <= ? ORDER BY run_at, id LIMIT 1`,
	);
	const markRunning = connection.prepare(
		`UPDATE platform_jobs SET state = 'running', started_at = ?, attempts = attempts + 1
			WHERE id = ? AND state = 'pending'`,
	);
	const selectNextDue = connection
		.prepare("SELECT min(run_at) FROM platform_jobs WHERE state = 'pending' AND run_at > ?")
		.pluck();
	const markEnded = connection.prepare(
		"UPDATE platform_jobs SET state = ?, finished_at = ?, error = ? WHERE id = ?",
	);

	/** The job running on each lane, with what aborts it and what settles once its end is recorded. */
	const running = new Map<
		Lane,
		{ readonly abort: AbortController; readonly done: Promise<void> }
	>();
	let stopped = false;

	const claim = connection.transaction((lane: Lane, now: number): JobRow | undefined => {
		const row = selectDue.get(lane, now) as JobRow | undefined;
		if (!row || markRunning.run(now, row.id).changes !== 1) return undefined;
		return row;
	});

	const finish = connection.transaction((job: FinishedJob) => {
		const error = job.outcome.state === "done" ? null : job.outcome.error;
		markEnded.run(job.outcome.state, job.finishedAt, error, job.id);
		onFinish?.(job);
	});

	function start(lane: Lane, row: JobRow, startedAt: number): void {
		const abort = new AbortController();
		const kind = kinds.get(row.kind);
		const done = Promise.resolve()
			.then(() => {
				if (!kind) throw new Error(`no job kind "${row.kind}" is declared`);
				return kind.run({ signal: abort.signal, startedAt });
			})
			.then(
				(): JobOutcome => ({ state: "done" }),
				(error: unknown): JobOutcome => ({
					state: abort.signal.aborted ? "cancelled" : "failed",
					error: messageOf(error),
				}),
			)
			.then((outcome) => {
				finish({
					id: row.id,
					kind: row.kind,
					taskRun: row.task_run,
					startedAt,
					finishedAt: clock(),
					outcome,
				});
				running.delete(lane);
				onIdle?.();
			});
		running.set(lane, { abort, done });
	}

	return {
		enqueue: (job) =>
			Number(
				insert.run(
					job.kind,
					laneOf(kinds, job.kind),
					job.runAt,
					job.taskRun ?? null,
					clock(),
				).lastInsertRowid,
			),

		pump() {
			if (stopped) return;
			for (const lane of LANES) {
				if (running.has(lane)) continue;
				const now = clock();
				const row = claim(lane, now);
				if (row) start(lane, row, now);
			}
		},

		nextDue: () => (selectNextDue.get(clock()) as number | null) ?? undefined,

		inFlight: () => [...running.values()].map(({ done }) => done),

		async stop() {
			stopped = true;
			const jobs = [...running.values()];
			for (const { abort } of jobs) abort.abort();
			await Promise.all(jobs.map(({ done }) => done));
		},
	};
}

function laneOf(kinds: ReadonlyMap<string, JobKind>, kind: string): Lane {
	const found = kinds.get(kind);
	if (!found) throw new Error(`no job kind "${kind}" is declared`);
	return found.lane;
}

/** What a failed job leaves in its row: the error's name and message, for whoever operates the system. */
function messageOf(error: unknown): string {
	return error instanceof Error
		? `${error.name}: ${error.message}`
		: "a non-Error value was thrown";
}

// The cleanup (ADR 0025, ADR 0022): maintenance of the platform, without actions and without an actor. It never
// changes an answer: a row that decides an answer stays as its minimal mark, and only what decides nothing goes.
// In the action log it empties the content (input and inverse) of the entries whose `expiresAt` passed, which
// nothing reads any more, and keeps their annotation, key and fingerprint, so a repeated write is still
// acknowledged and every account still reads its annotations. In the pending confirmations it empties the stored
// operation of those whose `expiresAt` passed, whatever their state, and keeps the rest of the row, which answers
// «consumed» or «expired». It removes the step-up proofs that ended and those issued and never used past their
// expiry, which answer «not valid» as a missing one does; a used one stays, since it proves the repeat of its
// write. It purges the jobs that ended more than 30 days ago and the runs that ended more than 90 days ago. Of the
// files (ADR 0028) it removes the prepared files that expired, were consumed or whose session no longer exists, and
// the released references whose entry expired or was undone, so that nothing they kept protects a content any
// more; then the sweeps of the store, which touch the disk, delete the contents nothing points to.
// It works in small batches, each in its own transaction, and checks its signal between
// them: one cut halfway leaves every batch it did whole, and the next run goes on where it stopped. Cleaning twice
// changes nothing.
import type Database from "better-sqlite3";

import type { Clock } from "../actions";
import { RELEASES_ENDED } from "../files/needed";
import { sessionLivesWhere } from "../identity/sessions";
import type { ScheduledTask, TaskSchedule } from "./scheduler";

export const CLEANUP_TASK = "cleanup";

/** The daily cleanup, at 04:30. */
export const CLEANUP_SCHEDULE: TaskSchedule = {
	id: CLEANUP_TASK,
	frequency: { every: "day", at: "04:30" },
};

/** How many rows one batch changes at most: small, so the API waits little for each transaction. */
const BATCH_SIZE = 500;
const DAY = 24 * 60 * 60 * 1000;
/** How long a job that ended (done, failed or cancelled) is kept. */
const JOBS_KEPT = 30 * DAY;
/** How long a run that ended is kept. */
const RUNS_KEPT = 90 * DAY;

export interface CleanupOptions {
	/** Rows per batch. Only the platform's own tests change it. */
	readonly batchSize?: number;
	/** The steps of the store of files, after the rows': none without a folder for it. */
	readonly sweeps?: readonly CleanupSweep[];
}

/**
 * A step of the cleanup that is more than one statement, such as one that touches the disk: it does at most a batch
 * of the work due at `now`, each part in its own transaction, and tells how much it found. Repeated until it finds
 * less than a batch.
 */
export type CleanupSweep = (now: number, batchSize: number) => Promise<number>;

/** A step as the loop runs it: a statement's batch runs at once, with no turn of the event loop before it. */
type Step = (now: number, batchSize: number) => number | Promise<number>;

/**
 * One step of the cleanup: a statement that changes at most a batch of the rows due by an instant, and how far
 * before now that instant is. Each takes the instant and the batch size, in that order.
 */
interface StatementStep {
	readonly sql: string;
	readonly age?: number;
}

const STEPS: readonly StatementStep[] = [
	{
		sql: `UPDATE platform_action_log SET input = NULL, inverse = NULL WHERE entry IN (
			SELECT entry FROM platform_action_log
			WHERE expires_at <= ? AND (input IS NOT NULL OR inverse IS NOT NULL) LIMIT ?)`,
	},
	{
		sql: `UPDATE platform_confirmations SET operation = NULL WHERE id IN (
			SELECT id FROM platform_confirmations WHERE expires_at <= ? AND operation IS NOT NULL LIMIT ?)`,
	},
	{
		sql: `DELETE FROM platform_proofs WHERE hash IN (
			SELECT hash FROM platform_proofs
			WHERE state = 'ended' OR (state = 'issued' AND expires_at <= ?) LIMIT ?)`,
	},
	{
		sql: `DELETE FROM platform_jobs WHERE id IN (
			SELECT id FROM platform_jobs
			WHERE state IN ('done', 'failed', 'cancelled') AND finished_at <= ? LIMIT ?)`,
		age: JOBS_KEPT,
	},
	// A run a job still points to waits until that job is purged.
	{
		sql: `DELETE FROM platform_task_runs WHERE id IN (
			SELECT id FROM platform_task_runs AS run
			WHERE result IS NOT NULL AND finished_at <= ?
				AND NOT EXISTS (SELECT 1 FROM platform_jobs WHERE task_run = run.id)
			LIMIT ?)`,
		age: RUNS_KEPT,
	},
	// A prepared file serves only its live session, unconsumed and before its expiry; past that it protects nothing.
	{
		sql: `DELETE FROM platform_prepared_files WHERE id IN (
			SELECT id FROM platform_prepared_files AS prepared
			WHERE expires_at <= ? OR consumed = 1
				OR NOT ${sessionLivesWhere("prepared.session", "prepared.account")}
			LIMIT ?)`,
	},
	// A released reference protects its content only while the entry that released it can still be undone.
	{
		sql: `DELETE FROM platform_file_references WHERE id IN (${RELEASES_ENDED} LIMIT ?)`,
	},
];

export function cleanupTask(
	connection: Database.Database,
	clock: Clock,
	{ batchSize = BATCH_SIZE, sweeps = [] }: CleanupOptions = {},
): ScheduledTask {
	const steps: readonly Step[] = [
		...STEPS.map(({ sql, age = 0 }): Step => {
			const statement = connection.prepare<[number, number]>(sql);
			return (now, size) =>
				connection.transaction(() => statement.run(now - age, size).changes)();
		}),
		...sweeps,
	];

	return {
		...CLEANUP_SCHEDULE,
		job: {
			lane: "maintenance",
			async run({ signal }) {
				const now = clock();
				for (const step of steps) {
					for (;;) {
						signal.throwIfAborted();
						const batch = step(now, batchSize);
						const changed = typeof batch === "number" ? batch : await batch;
						if (changed < batchSize) break;
						// Lets the API, the maximum time and the stop reach in between two batches.
						await nextTurn();
					}
				}
			},
		},
	};
}

/** Resolves on a later turn of the event loop, after the I/O and timers waiting now. */
function nextTurn(): Promise<void> {
	return new Promise((resolve) => setImmediate(resolve));
}

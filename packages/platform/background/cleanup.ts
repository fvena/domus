// The cleanup (ADR 0025, ADR 0022): maintenance of the platform, without actions and without an actor. It never
// changes an answer: a row that decides an answer stays as its minimal mark, and only what decides nothing goes.
// In the action log it empties the content (input and inverse) of the entries whose `expiresAt` passed, which
// nothing reads any more, and keeps their annotation, key and fingerprint, so a repeated write is still
// acknowledged and every account still reads its annotations. In the pending confirmations it empties the stored
// operation of those whose `expiresAt` passed, whatever their state, and keeps the rest of the row, which answers
// «consumed» or «expired». It removes the step-up proofs that ended and those issued and never used past their
// expiry, which answer «not valid» as a missing one does; a used one stays, since it proves the repeat of its
// write. And it purges the jobs that ended more than 30 days ago and the runs that ended more than 90 days ago.
// It works in small batches, each in its own transaction, and checks its signal between
// them: one cut halfway leaves every batch it did whole, and the next run goes on where it stopped. Cleaning twice
// changes nothing.
import type Database from "better-sqlite3";

import type { Clock } from "../actions";
import type { ScheduledTask } from "./scheduler";

export const CLEANUP_TASK = "cleanup";

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
}

/**
 * One step of the cleanup: a statement that changes at most a batch of the rows due by an instant, and how far
 * before now that instant is. Each takes the instant and the batch size, in that order.
 */
interface Step {
	readonly sql: string;
	readonly age?: number;
}

const STEPS: readonly Step[] = [
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
];

export function cleanupTask(
	connection: Database.Database,
	clock: Clock,
	{ batchSize = BATCH_SIZE }: CleanupOptions = {},
): ScheduledTask {
	const steps = STEPS.map(({ sql, age = 0 }) => ({
		statement: connection.prepare<[number, number]>(sql),
		age,
	}));

	return {
		id: CLEANUP_TASK,
		frequency: { every: "day", at: "04:30" },
		job: {
			lane: "maintenance",
			async run({ signal }) {
				const now = clock();
				for (const { statement, age } of steps) {
					const due = now - age;
					for (;;) {
						signal.throwIfAborted();
						const changed = connection.transaction(
							() => statement.run(due, batchSize).changes,
						)();
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

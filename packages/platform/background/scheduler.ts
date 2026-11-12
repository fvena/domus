// The scheduler (ADR 0025): the platform's scheduled tasks, at a local time of the house. Each planned run is
// unique by its task and local planned date, and keeps its absolute instant. When a run is due, marking the task's
// next run, recording the run and enqueuing its job happen in one transaction: nothing of it stays if one fails.
import { localDate, nextDailyOccurrence } from "@domus/utils/date-time";
import type Database from "better-sqlite3";

import type { Clock } from "../actions";
import type { FinishedJob, JobKind, NewJob } from "./engine";

/** The house's time zone: fixed here, never read from `TZ` or from the process. */
export const HOUSE_ZONE = "Europe/Madrid";

/** How often a task runs by default: every day at a local `HH:MM` of the house. */
export interface Frequency {
	readonly every: "day";
	readonly at: string;
}

/** A scheduled task the platform declares in its code: a stable id, its default frequency and its job. */
export interface ScheduledTask {
	readonly id: string;
	readonly frequency: Frequency;
	/** The task's work. Its job kind is named after the task's id. */
	readonly job: JobKind;
}

/** One run of a scheduled task, as the log of runs keeps it. */
export interface TaskRun {
	readonly id: number;
	readonly task: string;
	/** The local planned date, `YYYY-MM-DD` in the house's zone; null for a manual run. */
	readonly plannedDate: string | null;
	readonly plannedAt: number;
	readonly startedAt: number | null;
	readonly finishedAt: number | null;
	/** Null until it ends. */
	readonly result: "ok" | "failed" | "cancelled" | "stuck" | "skipped" | null;
	readonly error: string | null;
}

export interface SchedulerOptions {
	readonly connection: Database.Database;
	readonly clock: Clock;
	readonly tasks: readonly ScheduledTask[];
	/** Stores a run's job, inside the transaction that marks the task's next run. */
	readonly enqueue: (job: NewJob) => number;
	/** The zone of the local times: {@link HOUSE_ZONE} unless a test gives another. */
	readonly zone?: string;
}

export interface Scheduler {
	/** Gives each declared task without a row its row, with its next run from now. Rows of others stay as they are. */
	sync(): void;
	/** Records and enqueues the run of each declared, unpaused task whose next run is due by the clock. */
	enqueueDue(): void;
	/** The earliest next run of a declared, unpaused task. */
	nextDue(): number | undefined;
	/** Records how a run ended, from its job's end. Runs inside the transaction that records the job's end. */
	finish(job: FinishedJob): void;
}

interface TaskRow {
	readonly id: string;
	readonly time: string | null;
	readonly paused: number;
	readonly next_at: number;
}

const RESULT_OF = { done: "ok", failed: "failed", cancelled: "cancelled" } as const;

export function createScheduler({
	connection,
	clock,
	tasks,
	enqueue,
	zone = HOUSE_ZONE,
}: SchedulerOptions): Scheduler {
	const insertTask = connection.prepare(
		"INSERT OR IGNORE INTO platform_tasks (id, next_at) VALUES (?, ?)",
	);
	const selectTask = connection.prepare("SELECT * FROM platform_tasks WHERE id = ?");
	const moveNext = connection.prepare("UPDATE platform_tasks SET next_at = ? WHERE id = ?");
	const insertRun = connection.prepare(
		`INSERT OR IGNORE INTO platform_task_runs (task, planned_date, planned_at)
			VALUES (?, ?, ?)`,
	);
	const endRun = connection.prepare(
		`UPDATE platform_task_runs SET started_at = ?, finished_at = ?, result = ?, error = ?
			WHERE id = ?`,
	);

	const nextAfter = (task: ScheduledTask, row: TaskRow | undefined, instant: number) =>
		nextDailyOccurrence(instant, row?.time ?? task.frequency.at, zone);

	/** The rows of the declared tasks; a declared task always has one after `sync`. */
	const rows = () =>
		tasks.flatMap((task) => {
			const row = selectTask.get(task.id) as TaskRow | undefined;
			return row ? [{ task, row }] : [];
		});

	const runDue = connection.transaction((task: ScheduledTask, row: TaskRow, now: number) => {
		moveNext.run(nextAfter(task, row, now), task.id);
		// A run already recorded for this planned date is not created again.
		const created = insertRun.run(task.id, localDate(row.next_at, zone), row.next_at);
		if (created.changes !== 1) return;
		enqueue({ kind: task.id, runAt: now, taskRun: Number(created.lastInsertRowid) });
	});

	return {
		sync() {
			const now = clock();
			for (const task of tasks) insertTask.run(task.id, nextAfter(task, undefined, now));
		},

		enqueueDue() {
			const now = clock();
			for (const { task, row } of rows())
				if (!row.paused && row.next_at <= now) runDue(task, row, now);
		},

		nextDue() {
			const due = rows()
				.filter(({ row }) => !row.paused)
				.map(({ row }) => row.next_at);
			return due.length === 0 ? undefined : Math.min(...due);
		},

		finish(job) {
			if (job.taskRun === null) return;
			const error = job.outcome.state === "done" ? null : job.outcome.error;
			endRun.run(
				job.startedAt,
				job.finishedAt,
				RESULT_OF[job.outcome.state],
				error,
				job.taskRun,
			);
		},
	};
}

/** Every run in the log, oldest first. */
export function readTaskRuns(connection: Database.Database): readonly TaskRun[] {
	return connection
		.prepare<[], TaskRun>(
			`SELECT id, task, planned_date AS plannedDate, planned_at AS plannedAt, started_at AS startedAt,
				finished_at AS finishedAt, result, error FROM platform_task_runs ORDER BY id`,
		)
		.all();
}

// The scheduler (ADR 0025): the platform's scheduled tasks, at a local time of the house. Each planned run is
// unique by its task and local planned date, and keeps its absolute instant. When a run is due, marking the task's
// next run, recording the run and enqueuing its job happen in one transaction: nothing of it stays if one fails.
import {
	localDate,
	nextDailyOccurrence,
	nextWeeklyOccurrence,
	type Weekday,
} from "@domus/utils/date-time";
import type Database from "better-sqlite3";

import type { Clock } from "../actions";
import type { FinishedJob, JobKind, NewJob } from "./engine";

/** The house's time zone: fixed here, never read from `TZ` or from the process. */
export const HOUSE_ZONE = "Europe/Madrid";

/** How often a task runs by default: every day, or every week on a weekday, at a local `HH:MM` of the house. */
export type Frequency =
	| { readonly every: "day"; readonly at: string }
	| { readonly every: "week"; readonly on: Weekday; readonly at: string };

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
	readonly result: "ok" | "failed" | "cancelled" | "skipped" | null;
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
	/** Stops creating runs of the task. Pausing a paused task changes nothing. */
	pause(task: string): void;
	/** Creates runs again, the next one from now: what it skipped while paused is not caught up. */
	resume(task: string): void;
	/** Sets the time the admin chose, or none to go back to the default, and moves the next run from now. */
	setTime(task: string, time: string | null): void;
	/**
	 * Records a manual run of the task, due now, and enqueues its job, in one transaction. Returns the run's id.
	 * Throws {@link TaskBusyError} when the task has a run pending or in progress, and creates nothing.
	 */
	launch(task: string): number;
	/** The time the admin chose for a declared task and whether it is paused. Throws {@link UnknownTaskError}. */
	state(task: string): TaskSettings;
	/** True when the code declares the task. Reads nothing. */
	has(task: string): boolean;
	/** Each declared task as the admin sees it, in the order of their declaration. Reads only. */
	overview(): readonly TaskOverview[];
}

/** One declared task as the admin sees it: what listing the tasks answers. */
export interface TaskOverview {
	readonly id: string;
	/** Its frequency with the time the admin chose, else its default. */
	readonly frequency: Frequency;
	readonly paused: boolean;
	readonly nextAt: number;
	/** The run the log recorded last, whichever its result. */
	readonly lastRun: {
		readonly manual: boolean;
		readonly plannedAt: number;
		readonly startedAt: number | null;
		readonly finishedAt: number | null;
		readonly result: TaskRun["result"];
		readonly error: string | null;
	} | null;
	/** True while one of its jobs is stuck. */
	readonly stuck: boolean;
}

/** A task with a run pending or in progress, stuck included: it gets no other. */
export class TaskBusyError extends Error {
	constructor(readonly task: string) {
		super(`the scheduled task "${task}" has a run pending or in progress`);
		this.name = "TaskBusyError";
	}
}

/** A task the code does not declare, or not anymore: its row, if any, is kept but not touched. */
export class UnknownTaskError extends Error {
	constructor(readonly task: string) {
		super(`no scheduled task is declared as "${task}"`);
		this.name = "UnknownTaskError";
	}
}

/** What the admin set on a scheduled task: the time it chose and whether it is paused. */
export type TaskSettings = Pick<TaskState, "time" | "paused">;

/** The state of a scheduled task, as its row keeps it across restarts. */
export interface TaskState {
	readonly id: string;
	/** The local `HH:MM` the admin chose; null for the task's default. */
	readonly time: string | null;
	readonly paused: boolean;
	readonly nextAt: number;
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
	const setState = connection.prepare(
		"UPDATE platform_tasks SET time = ?, paused = ?, next_at = ? WHERE id = ?",
	);
	const insertRun = connection.prepare(
		`INSERT OR IGNORE INTO platform_task_runs (task, planned_date, planned_at)
			VALUES (?, ?, ?)`,
	);
	const insertSkipped = connection.prepare(
		`INSERT OR IGNORE INTO platform_task_runs (task, planned_date, planned_at, finished_at, result)
			VALUES (?, ?, ?, ?, 'skipped')`,
	);
	/** Whether the task has a job in one of `states`. */
	const jobOfTaskIn = (states: string) =>
		connection
			.prepare(
				`SELECT 1 FROM platform_jobs JOIN platform_task_runs ON platform_task_runs.id = platform_jobs.task_run
					WHERE platform_task_runs.task = ? AND platform_jobs.state IN (${states})`,
			)
			.pluck();
	// A stuck job still runs: its task has a run in progress until it ends.
	const inProgress = jobOfTaskIn("'pending', 'running', 'stuck'");
	const stuckJob = jobOfTaskIn("'stuck'");
	const lastRun = connection.prepare<
		[string],
		{
			planned_date: string | null;
			planned_at: number;
			started_at: number | null;
			finished_at: number | null;
			result: TaskRun["result"];
			error: string | null;
		}
	>(
		`SELECT planned_date, planned_at, started_at, finished_at, result, error FROM platform_task_runs
			WHERE task = ? ORDER BY id DESC LIMIT 1`,
	);
	const endRun = connection.prepare(
		`UPDATE platform_task_runs SET started_at = ?, finished_at = ?, result = ?, error = ?
			WHERE id = ?`,
	);

	/** The task's next run after `instant`, at the time the admin chose or else at its default time. */
	const nextAfter = (task: ScheduledTask, row: TaskRow | undefined, instant: number) => {
		const time = row?.time ?? task.frequency.at;
		return task.frequency.every === "week"
			? nextWeeklyOccurrence(instant, task.frequency.on, time, zone)
			: nextDailyOccurrence(instant, time, zone);
	};

	/** The rows of the declared tasks; a declared task always has one after `sync`. */
	const rows = () =>
		tasks.flatMap((task) => {
			const row = selectTask.get(task.id) as TaskRow | undefined;
			return row ? [{ task, row }] : [];
		});

	/** The most recent planned run due by `now`, from the task's next run: those before it were missed. */
	const latestDue = (task: ScheduledTask, row: TaskRow, now: number) => {
		let latest = row.next_at;
		for (
			let next = nextAfter(task, row, latest);
			next <= now;
			next = nextAfter(task, row, next)
		)
			latest = next;
		return latest;
	};

	const runDue = connection.transaction((task: ScheduledTask, row: TaskRow, now: number) => {
		const planned = latestDue(task, row, now);
		moveNext.run(nextAfter(task, row, now), task.id);
		const date = localDate(planned, zone);
		// A task with a run in progress gets no other: this planned date stays in the log as skipped.
		if (inProgress.get(task.id) !== undefined) {
			insertSkipped.run(task.id, date, planned, now);
			return;
		}
		// A run already recorded for this planned date is not created again.
		const created = insertRun.run(task.id, date, planned);
		if (created.changes !== 1) return;
		enqueue({ kind: task.id, runAt: now, taskRun: Number(created.lastInsertRowid) });
	});

	const launch = connection.transaction((id: string, now: number): number => {
		const { task } = declared(id);
		if (inProgress.get(id) !== undefined) throw new TaskBusyError(id);
		// A manual run has no planned date, so it never takes the place of a planned one.
		const run = Number(insertRun.run(id, null, now).lastInsertRowid);
		enqueue({ kind: task.id, runAt: now, taskRun: run });
		return run;
	});

	/** A declared task and its row, created as `sync` would if the background has not started yet. */
	const declared = (id: string) => {
		const task = tasks.find((candidate) => candidate.id === id);
		if (!task) throw new UnknownTaskError(id);
		insertTask.run(id, nextAfter(task, undefined, clock()));
		return { task, row: selectTask.get(id) as TaskRow };
	};

	return {
		sync() {
			const now = clock();
			for (const task of tasks) insertTask.run(task.id, nextAfter(task, undefined, now));
		},

		enqueueDue() {
			const now = clock();
			// Each row is read outside its transaction: on the one synchronous connection nothing writes in between.
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

		pause(id) {
			const { row } = declared(id);
			if (!row.paused) setState.run(row.time, 1, row.next_at, id);
		},

		resume(id) {
			const { task, row } = declared(id);
			if (row.paused) setState.run(row.time, 0, nextAfter(task, row, clock()), id);
		},

		setTime(id, time) {
			const { task, row } = declared(id);
			const chosen = { ...row, time };
			// Computing the next run first refuses a time that is not HH:MM before anything is stored.
			setState.run(time, row.paused, nextAfter(task, chosen, clock()), id);
		},

		launch: (id) => launch(id, clock()),

		state(id) {
			const { row } = declared(id);
			return { time: row.time, paused: row.paused === 1 };
		},

		has: (id) => tasks.some((task) => task.id === id),

		overview() {
			const now = clock();
			return tasks.map((task) => {
				// A declared task without a row yet shows what `sync` would give it.
				const row = selectTask.get(task.id) as TaskRow | undefined;
				const last = lastRun.get(task.id);
				return {
					id: task.id,
					frequency: { ...task.frequency, at: row?.time ?? task.frequency.at },
					paused: row?.paused === 1,
					nextAt: row?.next_at ?? nextAfter(task, undefined, now),
					lastRun: last
						? {
								manual: last.planned_date === null,
								plannedAt: last.planned_at,
								startedAt: last.started_at,
								finishedAt: last.finished_at,
								result: last.result,
								error: last.error,
							}
						: null,
					stuck: stuckJob.get(task.id) !== undefined,
				};
			});
		},
	};
}

/** The state of every task with a row, declared or not, by id. */
export function readTaskStates(connection: Database.Database): readonly TaskState[] {
	return connection
		.prepare<[], { id: string; time: string | null; paused: number; nextAt: number }>(
			"SELECT id, time, paused, next_at AS nextAt FROM platform_tasks ORDER BY id",
		)
		.all()
		.map((row) => ({ ...row, paused: row.paused === 1 }));
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

// Background work inside `api` (ADR 0025): the engine and the scheduler of the platform's maintenance, driven by
// the platform's clock and timer. Whenever it wakes (at start, when a run or a job is due, when a lane frees up,
// and at least every minute), it records and enqueues the runs that are due and starts the jobs that are due on
// each free lane. Maintenance has no actor and no actions; module-sdk offers none of this.
import type Database from "better-sqlite3";

import type { Clock, Outbox } from "../actions";
import { CLEANUP_SCHEDULE, type CleanupSweep, cleanupTask } from "./cleanup";
import { createEngine, type JobKind } from "./engine";
import {
	createScheduler,
	moveNextRuns,
	type ScheduledTask,
	type TaskOverview,
	type TaskSchedule,
	type TaskSettings,
} from "./scheduler";
import type { Timer } from "./timer";

/** The longest the background sleeps without waking, even with nothing due. */
const HEARTBEAT = 60 * 1000;
/** How long the scheduler may go without a sign of life before the watcher reports it. */
export const SILENCE_THRESHOLD = 5 * 60 * 1000;

/**
 * Why the watcher says the background is degraded, in the fixed order `/health` lists them (ADR 0026).
 * `scheduler-silent`: no wake for more than {@link SILENCE_THRESHOLD}. `lane-stuck`: a lane holds a stuck job. The
 * backups' own come from their marks.
 */
export const BACKGROUND_REASONS = [
	"scheduler-silent",
	"lane-stuck",
	"backup-stale",
	"backup-retention-failed",
	"backup-check-failed",
] as const;
export type BackgroundReason = (typeof BACKGROUND_REASONS)[number];
export type BackupReason = Exclude<BackgroundReason, "scheduler-silent" | "lane-stuck">;

/**
 * The backups as `/health` tells them: turned off, none saved and none failed yet, none saved but an attempt failed,
 * or at least one saved.
 */
export type BackupsState = "off" | "none-yet" | "none" | "saved";

/**
 * What the watcher says of the background, for `/health`: states and reasons, nothing personal. `reasons` comes
 * only when degraded, never empty, in the order of {@link BACKGROUND_REASONS}; `backups` always.
 */
export type BackgroundHealth =
	| { readonly status: "ok"; readonly backups: BackupsState }
	| {
			readonly status: "degraded";
			readonly reasons: readonly [BackgroundReason, ...BackgroundReason[]];
			readonly backups: BackupsState;
	  };

/** The backups as the background takes them when they are on: their tasks, and what the watcher reads of their marks. */
export interface BackupsWatch {
	readonly tasks: readonly ScheduledTask[];
	/** Reads the marks in memory, never the database. */
	health(): {
		readonly state: Exclude<BackupsState, "off">;
		readonly reasons: readonly BackupReason[];
	};
}

export interface BackgroundOptions {
	readonly connection: Database.Database;
	readonly clock: Clock;
	readonly timer: Timer;
	/** The backups, when they are on: unset, they are off. */
	readonly backups?: BackupsWatch;
	/** The cleanup's steps of the store of files, when the platform has a folder for it. */
	readonly sweeps?: readonly CleanupSweep[];
	/** Tasks a test declares besides the platform's own. Only the testing entry passes them. */
	readonly extraTasks?: readonly ScheduledTask[];
	/** Synthetic job kinds a test declares, by name, to enqueue them itself. Only the testing entry passes them. */
	readonly extraKinds?: Readonly<Record<string, JobKind>>;
}

/** What starting the background found, for the log of `apps/api`. */
export interface BackgroundStart {
	/** The jobs a previous process left running and this start recovered. */
	readonly recovered: number;
}

export interface Background {
	/** True from `start` until `stop` has ended. */
	readonly active: boolean;
	/** Starts waking: recovers what a previous process left running, records the tasks' rows and runs what is due. Once only. */
	start(): BackgroundStart;
	/**
	 * Stores a job of `kind`, due now, with its data if given, and wakes. Returns its id. For the synthetic jobs of the
	 * testing entry.
	 */
	enqueue(kind: string, payload?: unknown): number;
	/** Where a write leaves its jobs, in its transaction, and its undo cancels them (ADR 0029). */
	readonly outbox: Outbox;
	/** Stops waking and claiming, cancels the running jobs and waits until they ended. */
	stop(): Promise<void>;
	/** Wakes now, as a due instant would. */
	wake(): void;
	/** Settles once no job is running, also those a job's end started. */
	settled(): Promise<void>;
	/** Pauses a declared task: it creates no run until it resumes. Throws {@link UnknownTaskError}. */
	pause(task: string): void;
	/** Resumes a declared task, its next run from now. Throws {@link UnknownTaskError}. */
	resume(task: string): void;
	/** Sets the local `HH:MM` the admin chose for a declared task, or null for its default. */
	setTime(task: string, time: string | null): void;
	/** Records a manual run of a declared task and enqueues its job, due now. Throws {@link TaskBusyError}. */
	launch(task: string): number;
	/** The time the admin chose for a declared task and whether it is paused. Throws {@link UnknownTaskError}. */
	state(task: string): TaskSettings;
	/** True when the code declares the task. */
	has(task: string): boolean;
	/** Each declared task as the admin sees it. Reads only. */
	overview(): readonly TaskOverview[];
	/**
	 * The watcher: degraded while the scheduler is silent past the threshold, a lane is stuck or the backups' marks
	 * give a reason, else ok; and the state of the backups.
	 */
	health(): BackgroundHealth;
}

export function createBackground({
	connection,
	clock,
	timer,
	backups,
	sweeps = [],
	extraTasks = [],
	extraKinds = {},
}: BackgroundOptions): Background {
	// The platform's own tasks first, in their order: the cleanup and, when they are on, the backups'.
	const tasks = [
		cleanupTask(connection, clock, { sweeps }),
		...(backups?.tasks ?? []),
		...extraTasks,
	];
	const ids = new Set<string>();
	for (const { id } of tasks) {
		if (ids.has(id)) throw new Error(`the scheduled task "${id}" is declared twice`);
		ids.add(id);
	}
	const kinds = new Map<string, JobKind>(tasks.map((task) => [task.id, task.job]));
	for (const [kind, job] of Object.entries(extraKinds)) {
		if (kinds.has(kind)) throw new Error(`the job kind "${kind}" is declared twice`);
		kinds.set(kind, job);
	}

	let state: "new" | "started" | "stopping" | "stopped" = "new";
	let cancelWait: (() => void) | undefined;
	// The scheduler's sign of life, in memory: the instant it last woke. It counts from the creation, so a
	// background that never starts falls silent too.
	let lastBeat = clock();

	const engine = createEngine({
		connection,
		clock,
		timer,
		kinds,
		onStart: (taskRun, startedAt) => scheduler.start(taskRun, startedAt),
		onFinish: (job) => scheduler.finish(job),
		onIdle: () => wake(),
	});
	const scheduler = createScheduler({
		connection,
		clock,
		tasks,
		enqueue: (job) => engine.enqueue(job),
	});

	function wake(): void {
		if (state !== "started") return;
		lastBeat = clock();
		cancelWait?.();
		scheduler.enqueueDue();
		engine.pump();
		const now = clock();
		const next = Math.min(
			now + HEARTBEAT,
			scheduler.nextDue() ?? Infinity,
			engine.nextDue() ?? Infinity,
		);
		cancelWait = timer.at(Math.max(next, now), wake);
	}

	/**
	 * Wakes after a change to a task or a job left in a write. Inside an open transaction, such as an action's, it wakes once the
	 * synchronous section that holds it has ended: a job must never start inside a transaction that may still roll
	 * back, and a wake after a rollback only finds nothing new.
	 */
	function wakeAfterChange(): void {
		if (connection.inTransaction) queueMicrotask(wake);
		else wake();
	}

	return {
		get active() {
			return state === "started" || state === "stopping";
		},

		start() {
			if (state !== "new") throw new Error("the background starts only once");
			const recovered = engine.recover();
			state = "started";
			scheduler.sync();
			wake();
			return { recovered };
		},

		enqueue(kind, payload) {
			const id = engine.enqueue({ kind, runAt: clock(), payload });
			wake();
			return id;
		},

		outbox: {
			enqueue(job) {
				engine.enqueue({ ...job, runAt: clock() });
				wakeAfterChange();
			},
			cancel: (entry) => {
				engine.cancelPendingOf(entry);
			},
		},

		async stop() {
			if (state !== "started") return;
			state = "stopping";
			cancelWait?.();
			await engine.stop();
			state = "stopped";
		},

		wake,

		// Each change wakes the background, so it waits for the task's new next run.
		pause(task) {
			scheduler.pause(task);
			wakeAfterChange();
		},

		resume(task) {
			scheduler.resume(task);
			wakeAfterChange();
		},

		setTime(task, time) {
			scheduler.setTime(task, time);
			wakeAfterChange();
		},

		launch(task) {
			const run = scheduler.launch(task);
			wakeAfterChange();
			return run;
		},

		state: (task) => scheduler.state(task),

		has: (task) => scheduler.has(task),

		overview: () => scheduler.overview(),

		health() {
			const found = new Set<BackgroundReason>();
			if (clock() - lastBeat > SILENCE_THRESHOLD) found.add("scheduler-silent");
			if (engine.stuck()) found.add("lane-stuck");
			const watched = backups?.health();
			for (const reason of watched?.reasons ?? []) found.add(reason);
			const state: BackupsState = watched?.state ?? "off";
			const [first, ...rest] = BACKGROUND_REASONS.filter((reason) => found.has(reason));
			if (first === undefined) return { status: "ok", backups: state };
			return { status: "degraded", reasons: [first, ...rest], backups: state };
		},

		async settled() {
			for (;;) {
				const running = engine.inFlight();
				if (running.length === 0) return;
				await Promise.all(running);
			}
		},
	};
}

/**
 * Moves the next run of each of the platform's tasks, with the backups' `backupSchedules`, to its next occurrence
 * from the clock's now, a paused one left as it is. Restoring does it on the copy it stages.
 */
export function rescheduleTasks(
	connection: Database.Database,
	clock: Clock,
	backupSchedules: readonly TaskSchedule[],
): void {
	moveNextRuns(connection, clock, [CLEANUP_SCHEDULE, ...backupSchedules]);
}

export { controlledTimer, type ControlledTimer, realTimer, type Timer } from "./timer";
export {
	readTaskRuns,
	readTaskStates,
	type ScheduledTask,
	type TaskRun,
	TaskBusyError,
	type TaskOverview,
	type TaskSchedule,
	type TaskSettings,
	type TaskState,
	UnknownTaskError,
} from "./scheduler";
export {
	discardUnfinishedJobs,
	INVALID_PAYLOAD,
	type JobContext,
	type JobKind,
	type JobResult,
	type JobSnapshot,
	PassingJobError,
	PermanentJobError,
	readJobs,
	UNDONE,
} from "./engine";

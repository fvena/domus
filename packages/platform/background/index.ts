// Background work inside `api` (ADR 0025): the engine and the scheduler of the platform's maintenance, driven by
// the platform's clock and timer. Whenever it wakes (at start, when a run or a job is due, when a lane frees up,
// and at least every minute), it records and enqueues the runs that are due and starts the jobs that are due on
// each free lane. Maintenance has no actor and no actions; module-sdk offers none of this.
import type Database from "better-sqlite3";

import type { Clock } from "../actions";
import { cleanupTask } from "./cleanup";
import { createEngine, type JobKind } from "./engine";
import { createScheduler, type ScheduledTask } from "./scheduler";
import type { Timer } from "./timer";

/** The longest the background sleeps without waking, even with nothing due. */
const HEARTBEAT = 60 * 1000;

export interface BackgroundOptions {
	readonly connection: Database.Database;
	readonly clock: Clock;
	readonly timer: Timer;
	/** Tasks a test declares besides the platform's own. Only the testing entry passes them. */
	readonly extraTasks?: readonly ScheduledTask[];
}

/** What starting the background found, for the log of `apps/api`. */
export interface BackgroundStart {
	/** The jobs a previous process left running and this start recovered. */
	readonly recovered: number;
}

export interface Background {
	/** True from `start` until `stop` has ended. */
	readonly active: boolean;
	/** Starts waking: records the tasks' rows and runs what is due. Once only. */
	start(): BackgroundStart;
	/** Stops waking and claiming, cancels the running jobs and waits until they ended. */
	stop(): Promise<void>;
	/** Wakes now, as a due instant would. */
	wake(): void;
	/** Settles once no job is running, also those a job's end started. */
	settled(): Promise<void>;
}

export function createBackground({
	connection,
	clock,
	timer,
	extraTasks = [],
}: BackgroundOptions): Background {
	const tasks = [cleanupTask(connection, clock), ...extraTasks];
	const ids = new Set<string>();
	for (const { id } of tasks) {
		if (ids.has(id)) throw new Error(`the scheduled task "${id}" is declared twice`);
		ids.add(id);
	}
	const kinds = new Map<string, JobKind>(tasks.map((task) => [task.id, task.job]));

	let state: "new" | "started" | "stopping" | "stopped" = "new";
	let cancelWait: (() => void) | undefined;

	const engine = createEngine({
		connection,
		clock,
		kinds,
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

	return {
		get active() {
			return state === "started" || state === "stopping";
		},

		start() {
			if (state !== "new") throw new Error("the background starts only once");
			state = "started";
			scheduler.sync();
			wake();
			return { recovered: 0 };
		},

		async stop() {
			if (state !== "started") return;
			state = "stopping";
			cancelWait?.();
			await engine.stop();
			state = "stopped";
		},

		wake,

		async settled() {
			for (;;) {
				const running = engine.inFlight();
				if (running.length === 0) return;
				await Promise.all(running);
			}
		},
	};
}

export { controlledTimer, type ControlledTimer, realTimer, type Timer } from "./timer";
export { readTaskRuns, type ScheduledTask, type TaskRun } from "./scheduler";
export type { JobContext } from "./engine";

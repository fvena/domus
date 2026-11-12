// The settings of the scheduled tasks (ADR 0025), operations of the platform's area on the path of the actions.
// Listing them is a read without personal data. Changing a task's time, pausing and resuming it are undoable
// `manage` writes, whose inverse brings back the time or the state it had; launching it now is an irreversible
// `manage` write. Being `manage`, each write needs a step-up proof; authorization decides who may. A task the code
// does not declare is not found, before anything asks for a proof.
import { ORPCError } from "@orpc/server";

import type { Background } from ".";
import { type PlatformOperation, platformOperation } from "../actions";
import { conflict } from "../actions/failures";
import { TASK_INPUTS } from "../contracts";
import { TaskBusyError } from "./scheduler";

/** Listing the tasks, by its full name. */
export const LIST_TASKS = "platform.listTasks";

/** The operations of the scheduled tasks of `background`. */
export function taskOperations(background: Background): readonly PlatformOperation[] {
	/** The task as listing shows it; one the code does not declare is not found. */
	const declared = ({ task }: { task: string }) => {
		const found = background.overview().find((candidate) => candidate.id === task);
		if (!found) throw new ORPCError("NOT_FOUND", { message: "no such scheduled task" });
		return found;
	};
	/** Puts the paused state back as it was: the inverse of pausing or resuming. */
	const stateBack = (task: string, paused: boolean) => ({
		action: paused ? "platform.pauseTask" : "platform.resumeTask",
		input: { task },
	});
	const noSubject = () => undefined;

	return [
		{
			name: "listTasks",
			kind: "read",
			inputSchema: undefined,
			subject: noSubject,
			run: () => background.overview(),
		},
		platformOperation({
			name: "setTaskTime",
			level: "manage",
			undoable: true,
			inputSchema: TASK_INPUTS.setTaskTime,
			subject: noSubject,
			find: declared,
			run: ({ task, time }) => {
				const before = background.state(task);
				background.setTime(task, time);
				return {
					result: { task, time },
					inverse: { action: "platform.setTaskTime", input: { task, time: before.time } },
				};
			},
		}),
		platformOperation({
			name: "pauseTask",
			level: "manage",
			undoable: true,
			inputSchema: TASK_INPUTS.pauseTask,
			subject: noSubject,
			find: declared,
			run: ({ task }) => {
				const before = background.state(task);
				background.pause(task);
				return { result: { task, paused: true }, inverse: stateBack(task, before.paused) };
			},
		}),
		platformOperation({
			name: "resumeTask",
			level: "manage",
			undoable: true,
			inputSchema: TASK_INPUTS.resumeTask,
			subject: noSubject,
			find: declared,
			run: ({ task }) => {
				const before = background.state(task);
				background.resume(task);
				return { result: { task, paused: false }, inverse: stateBack(task, before.paused) };
			},
		}),
		platformOperation({
			name: "launchTask",
			level: "manage",
			inputSchema: TASK_INPUTS.launchTask,
			subject: noSubject,
			find: declared,
			run: ({ task }) => {
				try {
					return { task, run: background.launch(task) };
				} catch (error) {
					if (error instanceof TaskBusyError) throw conflict("task-busy");
					throw error;
				}
			},
		}),
	];
}

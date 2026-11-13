// The child processes of the backups (ADR 0026): restic and the `quick_check` of a snapshot. When the job's signal
// aborts, the child gets SIGTERM and, if it has not ended within {@link KILL_GRACE}, SIGKILL. A run settles only
// once its child has ended, so the maintenance lane stays taken until then.
import { spawn } from "node:child_process";

import type { Clock } from "../actions";
import { PermanentJobError, type Timer } from "../background";

/** How long a child has after SIGTERM before SIGKILL: under the 10 s after which a job counts as stuck. */
export const KILL_GRACE = 5 * 1000;

/** The platform's clock and timer, which the tests control: how the backups wait. */
export interface ClockAndTimer {
	readonly clock: Clock;
	readonly timer: Timer;
}

export interface ChildRun {
	readonly env: NodeJS.ProcessEnv;
	readonly cwd?: string;
	/** The job's signal: aborting it ends the child, and the run rejects as cancelled. */
	readonly signal: AbortSignal;
}

export interface ChildResult {
	readonly code: number;
	readonly stdout: string;
}

/** The error of a step its job's signal cancelled. The engine reads why from the signal. */
export function cancelled(): PermanentJobError {
	return new PermanentJobError("the backup was cancelled");
}

/**
 * Runs `command` with `args` and settles with its exit code and standard output once it ended, or rejects as
 * {@link cancelled} once it ended after the signal aborted. Its standard error is ignored.
 */
export function runChild(
	command: string,
	args: readonly string[],
	{ env, cwd, signal }: ChildRun,
	{ clock, timer }: ClockAndTimer,
): Promise<ChildResult> {
	if (signal.aborted) return Promise.reject(cancelled());
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			env,
			...(cwd === undefined ? {} : { cwd }),
			stdio: ["ignore", "pipe", "ignore"],
		});
		let cancelKill: (() => void) | undefined;
		const terminate = () => {
			child.kill("SIGTERM");
			cancelKill = timer.at(clock() + KILL_GRACE, () => child.kill("SIGKILL"));
		};
		signal.addEventListener("abort", terminate, { once: true });
		const chunks: Buffer[] = [];
		child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
		const end = () => {
			signal.removeEventListener("abort", terminate);
			cancelKill?.();
		};
		child.on("error", (error) => {
			end();
			reject(error);
		});
		child.on("close", (code) => {
			end();
			if (signal.aborted) reject(cancelled());
			else resolve({ code: code ?? -1, stdout: Buffer.concat(chunks).toString("utf8") });
		});
	});
}

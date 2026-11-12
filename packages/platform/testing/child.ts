// The script of a test's child process (./children.ts): it takes the task in its first argument, tells the test
// over IPC once it holds it, and waits; only SIGKILL or the end of the test ends it. Run through tsx, never bundled.
import { join } from "node:path";

import type { ChildMessage, ChildTask } from "./children";

/**
 * What the child holds, kept referenced until it dies: a connection the garbage collector reclaims closes, and
 * with it goes its lock.
 */
const held: unknown[] = [];

async function hold(task: ChildTask): Promise<void> {
	if (task.hold === "platform") {
		const { createPlatform } = await import("../platform");
		held.push(
			createPlatform({ databaseFile: join(task.dataDirectory, "domus.db"), modules: [] }),
		);
	} else {
		const { takeExclusiveLock } = await import("../lock");
		held.push(takeExclusiveLock(task.dataDirectory));
	}
}

function tell(message: ChildMessage, then?: () => void): void {
	process.send?.(message, undefined, undefined, then);
}

// The IPC channel keeps the child alive; once the test's process is gone, nothing should stay behind.
process.on("disconnect", () => process.exit(0));

hold(JSON.parse(process.argv[2] ?? "") as ChildTask).then(
	() => tell({ ready: true }),
	(error: unknown) =>
		tell({ error: error instanceof Error ? error.message : String(error) }, () =>
			process.exit(1),
		),
);

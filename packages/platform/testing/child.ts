// The script of a test's child process (./children.ts): it takes the task in its first argument, tells the test
// over IPC once it holds it, and waits; only SIGKILL or the end of the test ends it. Run through tsx, never bundled.
import { join } from "node:path";

import type { ModuleDefinition } from "@domus/module-sdk";

import type { InterleavePoint } from "../files";
import type { Platform, PlatformRuntime } from "../platform";
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
	} else if (task.hold === "exclusive") {
		const { takeExclusiveLock } = await import("../lock");
		held.push(takeExclusiveLock(task.dataDirectory));
	} else if (task.hold === "restore") {
		await restoreUntil(task);
	} else if (task.hold === "publish") {
		await publishUntil(task);
	} else if (task.hold === "distribute") {
		await distributeUntil(task);
	} else {
		await deleteUntil(task);
	}
}

/**
 * Opens the platform, with `modules` and the runtime's `extra`, with an interleave that stops at `point` for good,
 * and runs `work` on it: the work that reaches the point waits on a promise that never settles, kept referenced.
 * Settles once it got there; fails when `work` ends or fails first.
 */
async function openUntil(
	point: InterleavePoint,
	dataDirectory: string,
	clock: () => number,
	work: (platform: Platform) => Promise<unknown>,
	{
		modules = [],
		extra = {},
	}: {
		readonly modules?: readonly ModuleDefinition[];
		readonly extra?: Partial<PlatformRuntime>;
	} = {},
): Promise<void> {
	const { openPlatform } = await import("../platform");
	await new Promise<void>((reached, failed) => {
		const platform = openPlatform(
			{ databaseFile: join(dataDirectory, "domus.db"), modules },
			{
				...extra,
				clock,
				// Room enough, whatever the machine has free: the test is about the cut.
				freeSpace: () => Number.MAX_SAFE_INTEGER,
				interleave: (at) => {
					if (at !== point) return undefined;
					const forever = new Promise<void>(() => {});
					held.push(forever);
					reached();
					return forever;
				},
			},
		);
		held.push(platform);
		work(platform).then(() => failed(new Error(`it ended without reaching ${point}`)), failed);
	});
}

/** Uploads the task's content for its session at the task's instant until its file is in place, before its rows. */
async function publishUntil(task: Extract<ChildTask, { hold: "publish" }>): Promise<void> {
	const { filesOf } = await import("../platform");
	const { sealContext } = await import("../authorization/context");
	const content = Buffer.from(task.content, "base64");
	await openUntil(
		"published",
		task.dataDirectory,
		() => task.now,
		async (platform) => {
			const files = filesOf(platform);
			if (files === undefined) throw new Error("the platform has no store of files");
			const context = sealContext({
				account: task.account,
				device: "child-device",
				session: task.session,
				deviceAccount: task.account,
				channel: "app",
				identity: "password",
			});
			await files.upload(
				context,
				new Request("http://domus.child/api/files", {
					method: "POST",
					body: content,
					headers: {
						"content-length": String(content.length),
						"x-file-name": "foto.jpg",
					},
				}),
			);
		},
	);
}

/**
 * Starts the background at the task's instant, with the task's modules, until a notice committed its deliveries and
 * its end is not yet recorded.
 */
async function distributeUntil(task: Extract<ChildTask, { hold: "distribute" }>): Promise<void> {
	const { backgroundOf } = await import("../platform");
	const modules = await Promise.all(
		task.modules.map(
			async (url) => ((await import(url)) as { default: ModuleDefinition }).default,
		),
	);
	await openUntil(
		"distributed",
		task.dataDirectory,
		() => task.now,
		async (platform) => {
			platform.startBackground();
			await backgroundOf(platform).settled();
		},
		{
			modules,
			// The cut comes before any delivery runs: one that would send is the child's error.
			extra: {
				fetch: (() => Promise.reject(new Error("a child sends no notice"))) as typeof fetch,
			},
		},
	);
}

/** Runs the cleanup at the task's instant until it gets to its point of deleting a content. */
async function deleteUntil(task: Extract<ChildTask, { hold: "delete" }>): Promise<void> {
	const { connectionOf, filesOf } = await import("../platform");
	const { cleanupTask } = await import("../background/cleanup");
	await openUntil(
		task.at,
		task.dataDirectory,
		() => task.now,
		async (platform) => {
			const sweeps = filesOf(platform)?.sweeps ?? [];
			const { job } = cleanupTask(connectionOf(platform), () => task.now, { sweeps });
			await job.run({
				id: 0,
				signal: new AbortController().signal,
				startedAt: task.now,
				payload: undefined,
				retryAt: () => undefined,
			});
		},
	);
}

/**
 * Restores until the task's cut point and stays there: the restore waits on a promise that never settles, kept
 * referenced with the suspended procedure and its lock.
 */
async function restoreUntil(task: Extract<ChildTask, { hold: "restore" }>): Promise<void> {
	const { runRestore } = await import("../backups/restore");
	const { defineModule } = await import("@domus/module-sdk");
	// Only what restoring reads of a module: its id and its migrations.
	const modules = (task.modules ?? []).map(({ id, migrations }) =>
		defineModule({ id, schema: {}, migrations }),
	);
	await new Promise<void>((reached, failed) => {
		runRestore(
			{
				databaseFile: join(task.dataDirectory, "domus.db"),
				modules,
				backups: task.backups,
			},
			{
				clock: Date.now,
				...(task.restic === undefined ? {} : { restic: task.restic }),
				cut: (point) => {
					if (point !== task.at) return undefined;
					const forever = new Promise<void>(() => {});
					held.push(forever);
					reached();
					return forever;
				},
			},
		).then(() => failed(new Error(`the restore ended without reaching ${task.at}`)), failed);
	});
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

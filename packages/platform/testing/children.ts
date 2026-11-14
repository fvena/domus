// Child processes for the tests that need a process to die (spec of phase 1d2, seam 3, and of phase 1d4, seam 3): a
// child takes what its
// task says over a data folder, tells the test once it holds it, and waits until the test kills it with SIGKILL.
// Only for tests: the child runs the TypeScript source through tsx, and nothing of production reaches it.
import { fork } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { ModuleMigration } from "@domus/module-sdk";

import type { BackupConfig } from "../backups";
import type { RestorePoint } from "../backups/restore";
import type { InterleavePoint } from "../files";

/** What a child holds over a data folder, the one that has or will have `domus.db` and `domus.lock`. */
export type ChildTask =
	/** The platform open, without modules, as `api` or `accounts` have it. */
	| { readonly hold: "platform"; readonly dataDirectory: string }
	/** The exclusive lock of the database, as restoring takes it. */
	| { readonly hold: "exclusive"; readonly dataDirectory: string }
	/**
	 * A restore of the latest snapshot, stopped at a cut point of its exchange: the child tells the test once it got
	 * there, and holds the exclusive lock until the test kills it. A restore that ends or fails before reaching the
	 * point is the child's error. The store of file contents is `files` in the data folder.
	 */
	| {
			readonly hold: "restore";
			readonly dataDirectory: string;
			readonly backups: BackupConfig;
			/** The restic executable: `restic` from the `PATH` unless given. */
			readonly restic?: string;
			/**
			 * The migrations of the modules the copy holds, in their order, for a child that cannot import a module:
			 * without them, a copy with any module's migration is refused.
			 */
			readonly modules?: readonly ChildModule[];
			readonly at: RestorePoint;
	  }
	/**
	 * An upload of `content` for a session of `account` at the instant `now`, without modules, stopped once its file
	 * is in place and before its rows: the child tells the test once it got there. The session must live at `now`.
	 */
	| {
			readonly hold: "publish";
			readonly dataDirectory: string;
			readonly now: number;
			readonly account: string;
			readonly session: string;
			/** The bytes of the upload, in base64. */
			readonly content: string;
	  }
	/**
	 * A cleanup at the instant `now`, without modules, stopped at a point of deleting a content: `claimed`, its row
	 * marked and its file in place, or `removed`, its file gone and its row still claimed. A cleanup that ends or
	 * fails before reaching the point is the child's error.
	 */
	| {
			readonly hold: "delete";
			readonly dataDirectory: string;
			readonly now: number;
			readonly at: Extract<InterleavePoint, "claimed" | "removed">;
	  }
	/**
	 * The background at the instant `now`, with the modules of `modules`, stopped once a notice's job committed its
	 * deliveries and before its end is recorded (`distributed`, ADR 0029): the child tells the test once it got there.
	 * Each of `modules` is the URL of a file whose default export is a module's definition, since a child cannot
	 * import a module. A background that settles first is the child's error, and nothing goes to a push service.
	 */
	| {
			readonly hold: "distribute";
			readonly dataDirectory: string;
			readonly now: number;
			readonly modules: readonly string[];
	  };

/** A module as a child restores with it: its id and its migrations, which travel as JSON. */
export interface ChildModule {
	readonly id: string;
	readonly migrations: readonly ModuleMigration[];
}

/** What a child tells the test: that it holds its task, or why it could not. */
export type ChildMessage = { readonly ready: true } | { readonly error: string };

/** A child that holds its task. Use it with `await using`: disposing kills it if the test did not. */
export interface TestChild extends AsyncDisposable {
	/** Kills the child with SIGKILL, so it frees nothing itself, and settles once it is gone. */
	kill(): Promise<void>;
}

const CHILD_SCRIPT = fileURLToPath(new URL("child.ts", import.meta.url));
const TSX = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;

/**
 * Starts a child process with `task` and settles once the child holds it. When the child cannot, it rejects with
 * the child's own error message, and the child is gone.
 */
export function startChild(task: ChildTask): Promise<TestChild> {
	const child = fork(CHILD_SCRIPT, [JSON.stringify(task)], {
		execArgv: ["--import", TSX],
		stdio: ["ignore", "inherit", "inherit", "ipc"],
	});
	const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
	const kill = async () => {
		if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
		await exited;
	};
	return new Promise((resolve, reject) => {
		// A child that cannot hold its task says why and exits by itself.
		let failure: string | undefined;
		child.once("message", (message: ChildMessage) => {
			if ("ready" in message) resolve({ kill, [Symbol.asyncDispose]: kill });
			else failure = message.error;
		});
		child.once("exit", (code, signal) =>
			reject(
				new Error(
					failure ?? `the child ended before holding its task: ${String(signal ?? code)}`,
				),
			),
		);
		child.once("error", reject);
	});
}

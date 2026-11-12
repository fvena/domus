// The snapshot of a backup (ADR 0026): `db.backup()` copies the live database page by page, between turns of the
// event loop, so `api` keeps answering, and a cancelled job aborts it from its progress callback. `quick_check`
// runs in a child Node process, which opens the snapshot read only: in `api` it would hold its one thread for the
// whole walk.
import { createRequire } from "node:module";

import type Database from "better-sqlite3";

import { cancelled, runChild, type Waiting } from "./child";

/** better-sqlite3 as this file resolves it: in the image, the copy next to the bundle. */
const SQLITE = createRequire(import.meta.url).resolve("better-sqlite3");

/** The pages `db.backup()` copies per turn of the event loop: better-sqlite3's own default. */
const PAGES_PER_STEP = 100;

/**
 * The child's program: it opens the file read only, prints the first line of `quick_check` and exits. Any failure,
 * opening a file that is no database included, ends it with another code.
 */
const QUICK_CHECK = `
const [sqlite, file] = process.argv.slice(1);
const Database = require(sqlite);
const db = new Database(file, { readonly: true, fileMustExist: true });
const result = db.pragma("quick_check", { simple: true });
db.close();
process.stdout.write(String(result));
`;

/** Copies the live database to `file`. When `signal` aborts, the copy stops at its next step and rejects. */
export async function takeSnapshot(
	connection: Database.Database,
	file: string,
	signal: AbortSignal,
): Promise<void> {
	await connection.backup(file, {
		progress: () => {
			if (signal.aborted) throw cancelled();
			return PAGES_PER_STEP;
		},
	});
}

/** True when `quick_check` of the snapshot at `file` says `ok`, checked in a child process. */
export async function passesQuickCheck(
	file: string,
	signal: AbortSignal,
	waiting: Waiting,
): Promise<boolean> {
	const { code, stdout } = await runChild(
		process.execPath,
		["-e", QUICK_CHECK, SQLITE, file],
		{ env: {}, signal },
		waiting,
	);
	return code === 0 && stdout === "ok";
}

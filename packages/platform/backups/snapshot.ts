// The snapshot of a backup (ADR 0027, which narrows ADR 0026): a child Node process with its own connection takes
// the database's shared lock, as `api` and `accounts` do, and `VACUUM INTO` copies the live database in one read
// transaction, out of `api`'s one thread. A cancelled job ends the child as any other. `quick_check` runs in another
// child, which opens the snapshot read only: in `api` it would hold its one thread for the whole walk.
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { PermanentJobError } from "../background";
import { LOCK_FILE, TAKE_SHARED_LOCK } from "../lock";
import { type ClockAndTimer, runChild } from "./child";

/** better-sqlite3 as this file resolves it: in the image, the copy next to the bundle. */
const SQLITE = createRequire(import.meta.url).resolve("better-sqlite3");

/** What the snapshot's child prints once its copy is whole. */
const COPIED = "copied";

/**
 * The snapshot's program: it takes the shared lock before it opens the database, copies it to the target and
 * prints {@link COPIED}. Any failure, the lock refused included, ends it with another code. Its lock goes with it.
 */
const SNAPSHOT = `
const [sqlite, lockFile, source, target] = process.argv.slice(1);
const Database = require(sqlite);
const lock = new Database(lockFile, { timeout: 0 });
lock.exec(${JSON.stringify(TAKE_SHARED_LOCK)});
const db = new Database(source, { readonly: true, fileMustExist: true });
db.prepare("VACUUM INTO ?").run(target);
db.close();
lock.close();
process.stdout.write(${JSON.stringify(COPIED)});
`;

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

/**
 * Copies the live database at `databaseFile` to `file` in a child process run by `node`. When `signal` aborts, the
 * child ends and the copy rejects as cancelled once it did. A copy that fails, such as one of a database it cannot
 * read whole, fails at once: the next night tries again.
 */
export async function takeSnapshot(
	databaseFile: string,
	file: string,
	signal: AbortSignal,
	clockAndTimer: ClockAndTimer,
	node = process.execPath,
): Promise<void> {
	const lockFile = join(dirname(databaseFile), LOCK_FILE);
	const { code, stdout } = await runChild(
		node,
		["-e", SNAPSHOT, SQLITE, lockFile, databaseFile, file],
		{ env: {}, signal },
		clockAndTimer,
	);
	if (code !== 0 || stdout !== COPIED)
		throw new PermanentJobError("the snapshot could not be taken");
}

/** True when `quick_check` of the snapshot at `file` says `ok`, checked in a child process. */
export async function passesQuickCheck(
	file: string,
	signal: AbortSignal,
	clockAndTimer: ClockAndTimer,
	node = process.execPath,
): Promise<boolean> {
	const { code, stdout } = await runChild(
		node,
		["-e", QUICK_CHECK, SQLITE, file],
		{ env: {}, signal },
		clockAndTimer,
	);
	return code === 0 && stdout === "ok";
}

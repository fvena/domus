// The snapshot of a backup (ADR 0027, which narrows ADR 0026): a child Node process with its own connection takes
// the database's shared lock, as `api` and `accounts` do, and `VACUUM INTO` copies the live database in one read
// transaction, out of `api`'s one thread. A cancelled job ends the child as any other. `quick_check` runs in another
// child, which opens the snapshot read only: in `api` it would hold its one thread for the whole walk. The same child
// lists the file contents the snapshot needs at its capture instant (ADR 0028), read from the snapshot and never
// from the live database, which goes on changing.
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { PermanentJobError } from "../background";
import { NEEDED_CONTENTS } from "../files/needed";
import { CONTENT_HASH } from "../files/store";
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
 * The check's program: it opens the file read only and prints the first line of `quick_check`. When that says
 * `ok`, each following line is the hash of a content the snapshot needs at the capture instant it gets. Any
 * failure, opening a file that is no database included, ends it with another code.
 */
const QUICK_CHECK = `
const [sqlite, file, capturedAt] = process.argv.slice(1);
const Database = require(sqlite);
const db = new Database(file, { readonly: true, fileMustExist: true });
const result = String(db.pragma("quick_check", { simple: true }));
const lines = [result];
if (result === "ok") {
	const needed = db.prepare(${JSON.stringify(NEEDED_CONTENTS)}).pluck();
	for (const hash of needed.iterate(Number(capturedAt))) lines.push(hash);
}
db.close();
process.stdout.write(lines.join("\\n"));
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

/**
 * Checks the snapshot at `file` with `quick_check` in a child process and, when it passes, gives the hashes of the
 * file contents it needs at `capturedAt`; undefined when it does not pass.
 */
export async function checkSnapshot(
	file: string,
	capturedAt: number,
	signal: AbortSignal,
	clockAndTimer: ClockAndTimer,
	node = process.execPath,
): Promise<readonly string[] | undefined> {
	const { code, stdout } = await runChild(
		node,
		["-e", QUICK_CHECK, SQLITE, file, String(capturedAt)],
		{ env: {}, signal },
		clockAndTimer,
	);
	const [result, ...contents] = stdout.split("\n");
	if (code !== 0 || result !== "ok") return undefined;
	// A hash is a path in the store: anything else read from the snapshot never names one.
	if (!contents.every((hash) => CONTENT_HASH.test(hash)))
		throw new PermanentJobError("the snapshot names a file content that is no hash");
	return contents;
}

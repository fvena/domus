// The lock of the database (ADR 0026): an OS lock on `domus.lock`, a stable file next to `domus.db` that is never
// replaced nor deleted. Node has no `flock`, so the lock is an SQLite database in `DELETE` mode, whose `fcntl` locks
// hold across processes and containers on the same volume and, through SQLite's own table of open files, between
// connections of one process. Opening the platform holds it shared, and so does the child of a backup's snapshot
// (ADR 0027); restoring holds it exclusive. A lock is freed when its connection closes or its process dies.
//
// Inside one process, SQLite alone may open `domus.lock`: closing any other descriptor of that file (a read with
// `node:fs`, say) drops every `fcntl` lock the process holds on it.
import { join } from "node:path";

import Database from "better-sqlite3";

import { errorCode } from "./error-code";

/** The lock's file, in the data folder next to `domus.db`. */
export const LOCK_FILE = "domus.lock";

/**
 * A lock held until {@link DatabaseLock.release} or the end of the process. Keep it referenced while it must hold:
 * the garbage collector closes an unreachable connection, and its lock goes with it.
 */
export interface DatabaseLock {
	/** Frees the lock. Safe to call more than once. */
	release(): void;
}

/** The minimal table of the lock: the shared lock is a real read of it, since `BEGIN` alone or `SELECT 1` lock nothing. */
const TABLE = "domus_lock";

/** How every holder sets the lock's file before taking it. */
const DELETE_MODE = "PRAGMA journal_mode = DELETE;";

/**
 * What takes the shared lock on a connection to the lock's file, opened without waiting on a busy lock: a read
 * transaction of the lock's table, created when missing, held until the connection closes. The child process of a
 * backup's snapshot runs the same statements (ADR 0027).
 */
export const TAKE_SHARED_LOCK = `${DELETE_MODE}
CREATE TABLE IF NOT EXISTS ${TABLE} (id INTEGER PRIMARY KEY);
BEGIN;
SELECT count(*) FROM ${TABLE};`;

/**
 * Takes the shared lock that opening the platform holds until `close()`. It fails at once while restoring holds the
 * exclusive one.
 */
export function takeSharedLock(dataDirectory: string): DatabaseLock {
	return hold(dataDirectory, "restore in progress", TAKE_SHARED_LOCK);
}

/** Takes the exclusive lock for restoring, without waiting: it fails while anyone holds the shared one. */
export function takeExclusiveLock(dataDirectory: string): DatabaseLock {
	return hold(
		dataDirectory,
		"the database is in use: stop api and accounts first",
		`${DELETE_MODE} BEGIN EXCLUSIVE;`,
	);
}

/** Opens the lock's file without waiting on a busy lock and runs `take`; a busy lock throws `busy`, any other failure as it came. */
function hold(dataDirectory: string, busy: string, take: string): DatabaseLock {
	const db = new Database(join(dataDirectory, LOCK_FILE), { timeout: 0 });
	try {
		db.exec(take);
	} catch (error) {
		db.close();
		if (errorCode(error)?.startsWith("SQLITE_BUSY")) throw new Error(busy);
		throw error;
	}
	return {
		release: () => {
			if (db.open) db.close();
		},
	};
}

// The platform as a whole (ADR 0021): what createPlatform opens at start and close releases at stop.
// Today it holds the SQLite connection; the migrations (phase 1a) and the modules come next.
import { isAbsolute } from "node:path";

import Database from "better-sqlite3";

export interface PlatformOptions {
	/** An absolute path to the SQLite file, or `":memory:"` for tests. */
	readonly databaseFile: string;
}

export interface Platform {
	/** Closes the SQLite connection. Safe to call more than once. */
	close(): void;
}

const IN_MEMORY = ":memory:";

/** The connection behind each platform, kept out of its public shape: only platform reaches it. */
const connections = new WeakMap<Platform, Database.Database>();

export function createPlatform({ databaseFile }: PlatformOptions): Platform {
	if (databaseFile !== IN_MEMORY && !isAbsolute(databaseFile)) {
		throw new Error(
			`databaseFile must be an absolute path or ":memory:", got "${databaseFile}"`,
		);
	}

	const db = new Database(databaseFile);
	try {
		if (databaseFile !== IN_MEMORY) {
			const mode = db.pragma("journal_mode = WAL", { simple: true });
			if (mode !== "wal")
				throw new Error(`could not turn on WAL for ${databaseFile}: ${String(mode)}`);
		}
		db.pragma("foreign_keys = ON");
	} catch (error) {
		db.close();
		throw error;
	}

	const platform: Platform = {
		close: () => {
			if (db.open) db.close();
		},
	};
	connections.set(platform, db);
	return platform;
}

/** The SQLite connection of a platform. Inside platform only. */
export function connectionOf(platform: Platform): Database.Database {
	const db = connections.get(platform);
	if (!db) throw new Error("not a platform made by createPlatform");
	return db;
}

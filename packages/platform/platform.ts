// The platform as a whole (ADR 0021): what createPlatform opens at start and close releases at stop.
// It checks the module definitions, opens SQLite and brings its schema up to date before anything uses it.
import { isAbsolute } from "node:path";

import { checkModules, type ModuleDefinition } from "@domus/module-sdk";
import Database from "better-sqlite3";

import { migrations, PLATFORM_MODULE } from "./migrations";
import { migrate } from "./migrator";

export interface PlatformOptions {
	/** An absolute path to the SQLite file, or `":memory:"` for tests. */
	readonly databaseFile: string;
	/** The modules, in the order their migrations run, after the platform's own. */
	readonly modules: readonly ModuleDefinition[];
}

export interface Platform {
	/** How many migrations this start applied, for the log of `apps/api`. */
	readonly appliedMigrations: number;
	/** Closes the SQLite connection. Safe to call more than once. */
	close(): void;
}

const IN_MEMORY = ":memory:";

/** The connection and modules behind each platform, kept out of its public shape: only platform reaches them. */
const internals = new WeakMap<
	Platform,
	{ readonly db: Database.Database; readonly modules: readonly ModuleDefinition[] }
>();

/** Opens SQLite and applies the pending migrations. On any failure it closes the connection and throws. */
export function createPlatform({ databaseFile, modules }: PlatformOptions): Platform {
	if (databaseFile !== IN_MEMORY && !isAbsolute(databaseFile)) {
		throw new Error(
			`databaseFile must be an absolute path or ":memory:", got "${databaseFile}"`,
		);
	}
	checkModules(modules);

	const db = new Database(databaseFile);
	let appliedMigrations: number;
	try {
		if (databaseFile !== IN_MEMORY) {
			const mode = db.pragma("journal_mode = WAL", { simple: true });
			if (mode !== "wal")
				throw new Error(`could not turn on WAL for ${databaseFile}: ${String(mode)}`);
		}
		db.pragma("foreign_keys = ON");
		appliedMigrations = migrate(db, [
			{ module: PLATFORM_MODULE, migrations },
			...modules.map((module) => ({ module: module.id, migrations: module.migrations })),
		]);
	} catch (error) {
		db.close();
		throw error;
	}

	const platform: Platform = {
		appliedMigrations,
		close: () => {
			if (db.open) db.close();
		},
	};
	internals.set(platform, { db, modules });
	return platform;
}

function internalsOf(platform: Platform) {
	const found = internals.get(platform);
	if (!found) throw new Error("not a platform made by createPlatform");
	return found;
}

/** The SQLite connection of a platform. Inside platform only. */
export function connectionOf(platform: Platform): Database.Database {
	return internalsOf(platform).db;
}

/** The modules a platform received, in their order. Inside platform only. */
export function modulesOf(platform: Platform): readonly ModuleDefinition[] {
	return internalsOf(platform).modules;
}

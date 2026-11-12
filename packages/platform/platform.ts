// The platform as a whole (ADR 0021, ADR 0022): what createPlatform opens at start and close releases at stop.
// It checks the module definitions, opens SQLite and brings its schema up to date before anything uses it, and
// runs the modules' actions with the production authorizer, which in phase 1b denies everything.
import { isAbsolute } from "node:path";

import { checkModules, type ModuleDefinition, PLATFORM_ID } from "@domus/module-sdk";
import Database from "better-sqlite3";

import { type Actions, type Clock, createActions } from "./actions";
import { type ActionLog, createActionLog } from "./audit";
import { type Authorizer, denyEverything } from "./authorization";
import { migrations } from "./migrations";
import { migrate } from "./migrator";

export interface PlatformOptions {
	/** An absolute path to the SQLite file, or `":memory:"` for tests. */
	readonly databaseFile: string;
	/** The modules, in the order their migrations run, after the platform's own. */
	readonly modules: readonly ModuleDefinition[];
	/**
	 * How long the content of an entry in the action log (input, result, inverse) stays usable, in
	 * milliseconds: {@link DEFAULT_RETENTION} when unset. Each entry keeps the `expiresAt` it got when it was
	 * written, so a change applies only to new entries.
	 */
	readonly retention?: number;
}

/** The retention of the action log's content unless one is given: 30 days. */
const DEFAULT_RETENTION = 30 * 24 * 60 * 60 * 1000;

export interface Platform {
	/** How many migrations this start applied, for the log of `apps/api`. */
	readonly appliedMigrations: number;
	/** Closes the SQLite connection. Safe to call more than once. */
	close(): void;
}

/** What decides and what tells the time. Production fixes both; only the testing entry chooses them. */
export interface PlatformRuntime {
	readonly authorizer: Authorizer;
	readonly clock: Clock;
}

const IN_MEMORY = ":memory:";

/** The connection, modules, actions and action log behind each platform, kept out of its public shape: only platform reaches them. */
const internals = new WeakMap<
	Platform,
	{
		readonly db: Database.Database;
		readonly modules: readonly ModuleDefinition[];
		readonly actions: Actions;
		readonly actionLog: ActionLog;
	}
>();

/**
 * Opens SQLite and applies the pending migrations. On any failure it closes the connection and throws. It
 * takes no authorizer: in phase 1b every action is denied.
 */
export function createPlatform(options: PlatformOptions): Platform {
	return openPlatform(options, { authorizer: denyEverything, clock: Date.now });
}

/** createPlatform with a given runtime. Inside platform only; the testing entry hands it to test-utils. */
export function openPlatform(
	{ databaseFile, modules, retention = DEFAULT_RETENTION }: PlatformOptions,
	{ authorizer, clock }: PlatformRuntime,
): Platform {
	if (databaseFile !== IN_MEMORY && !isAbsolute(databaseFile)) {
		throw new Error(
			`databaseFile must be an absolute path or ":memory:", got "${databaseFile}"`,
		);
	}
	if (!Number.isSafeInteger(retention) || retention <= 0) {
		throw new Error(
			`retention must be a positive whole number of milliseconds, got ${String(retention)}`,
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
			{ module: PLATFORM_ID, migrations },
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
	const actionLog = createActionLog(db);
	const actions = createActions({
		connection: db,
		modules,
		authorizer,
		clock,
		actionLog,
		retention,
	});
	internals.set(platform, { db, modules, actions, actionLog });
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

/** The actions of a platform's modules. Inside platform only: no door serves them until phase 1c. */
export function actionsOf(platform: Platform): Actions {
	return internalsOf(platform).actions;
}

/** The action log of a platform. Inside platform only: who reads it is decided in phase 1c. */
export function actionLogOf(platform: Platform): ActionLog {
	return internalsOf(platform).actionLog;
}

// The platform as a whole (ADR 0021, ADR 0022, ADR 0023): what createPlatform opens at start and close releases
// at stop. It checks the module definitions, opens SQLite and brings its schema up to date before anything uses
// it, makes sure the one device account exists, installs the write capture of the modules' owned tables, and
// runs the modules' actions with the production authorizer.
import { dirname, isAbsolute } from "node:path";

import { checkModules, type ModuleDefinition, PLATFORM_ID } from "@domus/module-sdk";
import Database from "better-sqlite3";

import { type Actions, type Clock, createActions } from "./actions";
import { type Capture, installCapture } from "./actions/capture";
import { type ConfirmationTimes, createConfirmations } from "./actions/confirmations";
import { createProofs, type Proofs } from "./actions/proofs";
import { type ActionLog, createActionLog } from "./audit";
import { type AreaPolicy, type Authorizer, createAuthorizer } from "./authorization";
import {
	type Background,
	type BackgroundStart,
	createBackground,
	type JobKind,
	realTimer,
	type ScheduledTask,
	type Timer,
} from "./background";
import { taskOperations } from "./background/operations";
import { type BackupConfig, createBackups } from "./backups";
import { refuseWhileRestorePending } from "./backups/restore";
import { accessView, registeredAreas } from "./identity/access";
import { ensureDeviceAccount } from "./identity/accounts";
import { platformOperations } from "./identity/operations";
import type { ProofIssuer } from "./identity/proofs";
import { type DatabaseLock, takeSharedLock } from "./lock";
import { migrations } from "./migrations";
import { migrate } from "./migrator";

export interface PlatformOptions {
	/** An absolute path to the SQLite file, or `":memory:"` for tests. */
	readonly databaseFile: string;
	/** The modules, in the order their migrations run, after the platform's own. */
	readonly modules: readonly ModuleDefinition[];
	/**
	 * How long the content of an entry in the action log (input, inverse) stays usable, in
	 * milliseconds: {@link DEFAULT_RETENTION} when unset. Each entry keeps the `expiresAt` it got when it was
	 * written, so a change applies only to new entries.
	 */
	readonly retention?: number;
	/**
	 * The deadlines of a new pending confirmation, in milliseconds: its voice window and its expiry,
	 * {@link DEFAULT_CONFIRMATION_TIMES} for each one unset. Each pending confirmation keeps the absolute
	 * instants it got when it was born, so a change applies only to new ones.
	 */
	readonly confirmation?: Partial<ConfirmationTimes>;
	/**
	 * Where the backups go and the file of their password (ADR 0026): unset, the backups are off and their tasks are
	 * not declared. Only with a database on a file: their staging folder lives next to it.
	 */
	readonly backups?: BackupConfig;
}

/** The retention of the action log's content unless one is given: 30 days. */
const DEFAULT_RETENTION = 30 * 24 * 60 * 60 * 1000;

/** A pending confirmation's voice window, 60 seconds, and its expiry, 24 hours, unless others are given. */
const DEFAULT_CONFIRMATION_TIMES: ConfirmationTimes = {
	window: 60 * 1000,
	expiry: 24 * 60 * 60 * 1000,
};

export interface Platform {
	/** How many migrations this start applied, for the log of `apps/api`. */
	readonly appliedMigrations: number;
	/**
	 * Starts the background work (ADR 0025): the scheduler of the platform's maintenance and the engine that runs
	 * its jobs. After opening the platform and before serving. Once only.
	 */
	startBackground(): BackgroundStart;
	/**
	 * Stops the background work: no new job is claimed, the running ones are cancelled, and it settles once they
	 * ended. Before closing. Safe to call when it never started.
	 */
	stopBackground(): Promise<void>;
	/**
	 * Closes the SQLite connection. Safe to call more than once. Throws while the background is active: a job
	 * could still be using the connection.
	 */
	close(): void;
}

/**
 * What tells the time and, only for the internal tests of platform that must force a failure, another
 * authorizer than the production one. The testing entry hands test-utils the clock alone.
 */
export interface PlatformRuntime {
	readonly clock: Clock;
	readonly authorizer?: Authorizer;
	/** How the background waits for an instant of `clock`: a real timer unless a test controls it. */
	readonly timer?: Timer;
	/** Scheduled tasks a test declares besides the platform's own. */
	readonly tasks?: readonly ScheduledTask[];
	/** Synthetic job kinds a test declares, by name, to enqueue them itself. */
	readonly jobs?: Readonly<Record<string, JobKind>>;
	/** The restic executable of the backups: `restic` from the `PATH` unless a test gives another. */
	readonly restic?: string;
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
		readonly clock: Clock;
		readonly areas: ReadonlyMap<string, AreaPolicy>;
		readonly authorizer: Authorizer;
		readonly proofs: Proofs;
		readonly background: Background;
	}
>();

/** Opens SQLite and applies the pending migrations. On any failure it closes the connection and throws. */
export function createPlatform(options: PlatformOptions): Platform {
	return openPlatform(options, { clock: Date.now });
}

/** createPlatform with a given runtime. Inside platform only; the testing entry hands test-utils its clock part. */
export function openPlatform(
	{
		databaseFile,
		modules,
		retention = DEFAULT_RETENTION,
		confirmation = {},
		backups: backupConfig,
	}: PlatformOptions,
	{ clock, authorizer, timer = realTimer(clock), tasks, jobs, restic }: PlatformRuntime,
): Platform {
	if (databaseFile !== IN_MEMORY && !isAbsolute(databaseFile)) {
		throw new Error(
			`databaseFile must be an absolute path or ":memory:", got "${databaseFile}"`,
		);
	}
	if (backupConfig) {
		if (databaseFile === IN_MEMORY)
			throw new Error("backups need a database on a file, not in memory");
		for (const [name, path] of Object.entries(backupConfig))
			if (!isAbsolute(path))
				throw new Error(`backups.${name} must be an absolute path, got "${path}"`);
	}
	if (!Number.isSafeInteger(retention) || retention <= 0) {
		throw new Error(
			`retention must be a positive whole number of milliseconds, got ${String(retention)}`,
		);
	}
	const confirmationTimes: ConfirmationTimes = { ...DEFAULT_CONFIRMATION_TIMES, ...confirmation };
	for (const [name, value] of Object.entries(confirmationTimes))
		if (!Number.isSafeInteger(value) || value <= 0)
			throw new Error(
				`confirmation.${name} must be a positive whole number of milliseconds, got ${String(value)}`,
			);
	checkModules(modules);

	const areas = registeredAreas(modules);
	// Before the data is touched, and held until close: no restore runs while the platform has the database open.
	const lock = databaseFile === IN_MEMORY ? undefined : takeSharedLock(dirname(databaseFile));
	const db = openFile(databaseFile, lock);
	let appliedMigrations: number;
	let capture: Capture;
	let background: Background;
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
		ensureDeviceAccount(db, areas, clock());
		// After the migrations, which its triggers would stop from dropping a column, and before any action.
		capture = installCapture(db, modules, areas);
		// The backups load their marks now; the background checks its tasks and kinds.
		background = createBackground({
			connection: db,
			clock,
			timer,
			...(backupConfig === undefined
				? {}
				: {
						backups: createBackups({
							connection: db,
							clock,
							timer,
							config: backupConfig,
							dataDir: dirname(databaseFile),
							...(restic === undefined ? {} : { executable: restic }),
						}),
					}),
			...(tasks === undefined ? {} : { extraTasks: tasks }),
			...(jobs === undefined ? {} : { extraKinds: jobs }),
		});
	} catch (error) {
		db.close();
		lock?.release();
		throw error;
	}

	const platform: Platform = {
		appliedMigrations,
		startBackground: () => background.start(),
		stopBackground: () => background.stop(),
		close: () => {
			if (background.active)
				throw new Error(
					"stop the background before closing the platform: a job may still use it",
				);
			if (db.open) db.close();
			lock?.release();
		},
	};
	const actionLog = createActionLog(db);
	const view = accessView(db, areas);
	const decider = authorizer ?? createAuthorizer(view);
	const proofs = createProofs(db);
	const actions = createActions({
		connection: db,
		modules,
		areas,
		authorizer: decider,
		view,
		capture,
		clock,
		actionLog,
		retention,
		confirmations: createConfirmations(db, confirmationTimes),
		proofs,
		operations: [...platformOperations(db, areas), ...taskOperations(background)],
	});
	internals.set(platform, {
		db,
		modules,
		actions,
		actionLog,
		clock,
		areas,
		authorizer: decider,
		proofs,
		background,
	});
	return platform;
}

/**
 * Opens the SQLite file, after the shared lock and once no restore is left unended in its folder; when it cannot,
 * frees the lock taken for it.
 */
function openFile(databaseFile: string, lock: DatabaseLock | undefined): Database.Database {
	try {
		// A marker means the exchange of a restore was cut: the files beside it may be half of each set.
		if (lock) refuseWhileRestorePending(dirname(databaseFile));
		return new Database(databaseFile);
	} catch (error) {
		lock?.release();
		throw error;
	}
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

/** The actions of a platform's modules. Inside platform only: the door serves them with a verified context. */
export function actionsOf(platform: Platform): Actions {
	return internalsOf(platform).actions;
}

/** The action log of a platform. Inside platform only: an account reads its own annotations through the action `platform.readLog`. */
export function actionLogOf(platform: Platform): ActionLog {
	return internalsOf(platform).actionLog;
}

/** What asking for a step-up proof needs: the connection, the actions, where proofs live and the clock. Inside platform only. */
export function proofIssuerOf(platform: Platform): ProofIssuer {
	const { db, actions, proofs, clock } = internalsOf(platform);
	return { connection: db, actions, proofs, clock };
}

/** The registered areas, the platform's own first. Inside platform only. */
export function areasOf(platform: Platform): ReadonlyMap<string, AreaPolicy> {
	return internalsOf(platform).areas;
}

/** The background work of a platform. Inside platform only: the testing entry drives it in tests. */
export function backgroundOf(platform: Platform): Background {
	return internalsOf(platform).background;
}

/** The platform clock. Inside platform only. */
export function clockOf(platform: Platform): Clock {
	return internalsOf(platform).clock;
}

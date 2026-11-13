// Restoring a backup (ADR 0026): a function of the platform, without an actor and without actions, that the command
// `restore.mjs` of `apps/api` composes. It runs only with the database free: it holds the exclusive lock for the
// whole procedure, or refuses. It stages the snapshot apart, in a fixed staging folder of the data folder (checked,
// migrated and sanitized), and installs it with an exchange that, cut anywhere, leaves the previous database whole or
// the restored one sanitized. A marker published before the first auxiliary file goes keeps the platform from
// opening until running restore again ends the procedure.
//
// Invariants, each kept where its step is:
// - the staged copy is synced to disk before the marker is published;
// - the exclusive lock lasts the whole procedure, resuming included;
// - while the marker exists, nothing empties the staging folder of restoring nor creates another `before-restore`;
// - from the first removal of an auxiliary file on, the marker is already on disk.
import {
	closeSync,
	existsSync,
	fsyncSync,
	linkSync,
	mkdirSync,
	openSync,
	readFileSync,
	renameSync,
	rmSync,
	writeSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";

import { checkModules, type ModuleDefinition, PLATFORM_ID } from "@domus/module-sdk";
import Database from "better-sqlite3";

import type { Clock } from "../actions";
import { endEveryConfirmation } from "../actions/confirmations";
import { endEveryProof } from "../actions/proofs";
import { discardUnfinishedJobs, realTimer, rescheduleTasks } from "../background";
import { errorCode } from "../error-code";
import { endEverySession } from "../identity/sessions";
import { takeExclusiveLock } from "../lock";
import { migrations } from "../migrations";
import { migrate } from "../migrator";
import { BACKUP_SCHEDULES } from "./index";
import { createMarkStore } from "./marks";
import {
	type BackupConfig,
	createRestic,
	HOST,
	REPOSITORY_MISSING,
	type Restic,
	resticExited,
} from "./restic";
import { emptyFolder, SNAPSHOT_FILE } from "./staging";

/** The staging folder of restoring, inside the data folder. */
const STAGING = "restore-staging";
/** The marker of a restore that has not ended, in the data folder. */
export const MARKER = "restore.pending";
/** The marker while it is written, before its atomic rename. */
const MARKER_DRAFT = `${MARKER}.tmp`;
/** How long restic waits on a lock of the repository, so a restore never runs during a prune: it waits for it. */
const RETRY_LOCK = ["--retry-lock", "30m"];
/** What the jobs and runs a restore discards say. */
const DISCARDED = "discarded by restore";

export interface RestoreOptions {
	/** The absolute path of the live database, `domus.db` in the data folder. */
	readonly databaseFile: string;
	/** The modules, in the order of their migrations, as createPlatform takes them. */
	readonly modules: readonly ModuleDefinition[];
	/** The repository and its password. */
	readonly backups: BackupConfig;
	/** The id of the snapshot to restore, or a prefix of it: the latest of host `domus` when unset. */
	readonly snapshot?: string;
}

/** A snapshot of host `domus`: its id and when its data was captured. */
export interface SnapshotSummary {
	readonly id: string;
	readonly capturedAt: number;
}

/** What a restore did. */
export interface RestoreResult {
	readonly snapshot: string;
	readonly capturedAt: number;
	/** The folder that keeps the previous set of files, `before-restore-<instant>` in the data folder. */
	readonly preserved: string;
	/** True when it ended a restore that was cut, without staging anything again. */
	readonly resumed: boolean;
}

/**
 * The points of the exchange where the tests of the testing entry cut a restore. Production has no way to reach
 * them: only the testing entry passes a {@link RestoreRuntime.cut}.
 */
export type RestorePoint =
	/** `restore.pending.tmp` written and synced, not renamed yet. */
	| "marker-written"
	/** The marker renamed to `restore.pending` and the data folder synced. */
	| "marker-published"
	/** The old `-wal` and `-shm` removed and the data folder synced. */
	| "auxiliaries-removed"
	/** The staged copy renamed over the database, before syncing the folders. */
	| "database-renamed"
	/** The restored database installed and synced, the marker not removed yet. */
	| "database-installed";

/** What restoring runs with besides its options. The testing entry gives the clock, restic and the cut points. */
export interface RestoreRuntime {
	readonly clock: Clock;
	/** The restic executable: `restic` from the `PATH` unless a test gives another. */
	readonly restic?: string;
	/** Called at each point of the exchange; a test stops the procedure there. */
	readonly cut?: (point: RestorePoint) => Promise<void> | void;
}

/** What the marker holds: the folder of the previous set, and where the restored copy came from and when. */
interface Marker {
	readonly preserved: string;
	readonly snapshot: string;
	readonly capturedAt: number;
	readonly at: number;
}

/** Restores the latest snapshot of host `domus`, or the one given. See {@link runRestore}. */
export function restore(options: RestoreOptions): Promise<RestoreResult> {
	return runRestore(options, { clock: Date.now });
}

/**
 * Restores with the given runtime: takes the exclusive lock or refuses, then ends a restore that was cut, or
 * stages the snapshot apart and installs it. While it stages, and when it refuses, the live database stays untouched.
 */
export async function runRestore(
	{ databaseFile, modules, backups, snapshot }: RestoreOptions,
	runtime: RestoreRuntime,
): Promise<RestoreResult> {
	const { clock, cut } = runtime;
	if (!isAbsolute(databaseFile))
		throw new Error(`databaseFile must be an absolute path, got "${databaseFile}"`);
	// The same check as opening the platform, before anything of the data folder is touched.
	checkModules(modules);
	const dataDir = dirname(databaseFile);
	const files = filesOf(databaseFile);
	// Held, and referenced, until the end: the garbage collector would close an unreachable connection, and its lock.
	const lock = takeExclusiveLock(dataDir);
	try {
		const pending = readMarker(dataDir);
		if (pending) {
			await install(files, pending, cut);
			return { ...result(files, pending), resumed: true };
		}

		const staged = await stage(files, modules, resticOf(backups, runtime), snapshot, clock);
		const marker = await publish(files, staged, clock(), cut);
		await install(files, marker, cut);
		return { ...result(files, marker), resumed: false };
	} finally {
		lock.release();
	}
}

/** The snapshots of host `domus`, oldest first. An empty repository folder, not initialized yet, has none. */
export function listSnapshots(
	backups: BackupConfig,
	runtime: Pick<RestoreRuntime, "clock" | "restic">,
): Promise<readonly SnapshotSummary[]> {
	return snapshotsOf(resticOf(backups, runtime));
}

/** restic on the repository of `backups`, as the runtime gives it, on the real timer of its clock. */
function resticOf(
	backups: BackupConfig,
	{ clock, restic: executable = "restic" }: Pick<RestoreRuntime, "clock" | "restic">,
): Restic {
	return createRestic(executable, backups, { clock, timer: realTimer(clock) });
}

/** The snapshots of host `domus` that `restic` lists, oldest first, with `extra` arguments. */
async function snapshotsOf(
	restic: Restic,
	extra: readonly string[] = [],
): Promise<readonly SnapshotSummary[]> {
	const { code, stdout } = await restic.run(
		["snapshots", "--json", "--host", HOST, ...extra],
		never(),
	);
	if (code === REPOSITORY_MISSING) return [];
	if (code !== 0) throw new Error(resticExited("snapshots", code));
	const listed = JSON.parse(stdout) as { id: string; time: string }[];
	return listed
		.map(({ id, time }) => ({ id, capturedAt: Date.parse(time) }))
		.sort((a, b) => a.capturedAt - b.capturedAt);
}

/** The paths a restore works with, from the live database's. */
interface Files {
	readonly dataDir: string;
	readonly database: string;
	/** The live database's `-wal` and `-shm`. */
	readonly auxiliaries: readonly string[];
	readonly staging: string;
	/** The staged copy, in the staging folder. */
	readonly staged: string;
	readonly marker: string;
	readonly draft: string;
}

function filesOf(databaseFile: string): Files {
	const dataDir = dirname(databaseFile);
	const staging = join(dataDir, STAGING);
	return {
		dataDir,
		database: databaseFile,
		auxiliaries: [`${databaseFile}-wal`, `${databaseFile}-shm`],
		staging,
		staged: join(staging, SNAPSHOT_FILE),
		marker: join(dataDir, MARKER),
		draft: join(dataDir, MARKER_DRAFT),
	};
}

function result(files: Files, marker: Marker): Omit<RestoreResult, "resumed"> {
	return {
		snapshot: marker.snapshot,
		capturedAt: marker.capturedAt,
		preserved: join(files.dataDir, marker.preserved),
	};
}

/** What staging leaves: the copy synced in the staging folder, and where it came from. */
interface Staged {
	readonly snapshot: string;
	readonly capturedAt: number;
}

/**
 * Stages the snapshot apart: restic leaves it in the emptied staging folder, `quick_check` passes, its migrations
 * are an exact prefix of the code's and the missing ones are applied, it is sanitized in one transaction, and it is
 * closed without a WAL and synced with its folder. Any failure empties the staging folder and leaves the live
 * database untouched: no marker exists yet.
 */
async function stage(
	files: Files,
	modules: readonly ModuleDefinition[],
	restic: Restic,
	wanted: string | undefined,
	clock: Clock,
): Promise<Staged> {
	// No marker exists here, so emptying the staging folder and dropping a draft that was never published is safe.
	rmSync(files.draft, { force: true });
	emptyFolder(files.staging);
	try {
		const found = await chosenSnapshot(restic, wanted);
		const { code } = await restic.run(
			[
				"restore",
				found.id,
				"--target",
				files.staging,
				"--include",
				`/${SNAPSHOT_FILE}`,
				...RETRY_LOCK,
			],
			never(),
		);
		if (code !== 0) throw new Error(resticExited("restore", code));
		if (!existsSync(files.staged)) throw new Error("the snapshot holds no domus.db");

		sanitizeCopy(files, modules, found, clock());
		syncToDisk(files.staged);
		syncToDisk(files.staging);
		return { snapshot: found.id, capturedAt: found.capturedAt };
	} catch (error) {
		emptyFolder(files.staging);
		throw error;
	}
}

/** The snapshot to restore: the one whose id starts with `wanted`, or the latest. */
async function chosenSnapshot(
	restic: Restic,
	wanted: string | undefined,
): Promise<SnapshotSummary> {
	const all = await snapshotsOf(restic, RETRY_LOCK);
	if (wanted === undefined) {
		const latest = all[all.length - 1];
		if (!latest) throw new Error("there is no snapshot of host domus to restore");
		return latest;
	}
	const matching = all.filter(({ id }) => id.startsWith(wanted));
	if (matching.length === 0) throw new Error(`there is no snapshot ${wanted} of host domus`);
	if (matching.length > 1) throw new Error(`more than one snapshot starts with ${wanted}`);
	return matching[0] as SnapshotSummary;
}

/**
 * Checks, migrates and sanitizes the copy in the staging folder, and closes it in `DELETE` mode, without a WAL. The
 * migrations are validated and applied as createPlatform does: a copy newer than the code, or a migration that
 * fails, stops here with the migrator's message.
 */
function sanitizeCopy(
	files: Files,
	modules: readonly ModuleDefinition[],
	from: SnapshotSummary,
	now: number,
): void {
	const copy = new Database(files.staged, { fileMustExist: true });
	try {
		let check: unknown;
		try {
			check = copy.pragma("quick_check", { simple: true });
		} catch {
			check = undefined;
		}
		if (check !== "ok") throw new Error("the snapshot failed quick_check");
		copy.pragma("foreign_keys = ON");
		migrate(copy, [
			{ module: PLATFORM_ID, migrations },
			...modules.map((module) => ({ module: module.id, migrations: module.migrations })),
		]);

		const marks = createMarkStore(copy);
		copy.transaction(() => {
			// Nothing of the copy repeats a notice or an effect that already went out; a normal restart still recovers.
			discardUnfinishedJobs(copy, now, DISCARDED);
			// The tasks the platform declares with the backups on, each one's next run from its frequency.
			rescheduleTasks(copy, () => now, BACKUP_SCHEDULES);
			// A session revoked, or a password changed, after the copy must not come back.
			endEverySession(copy);
			endEveryConfirmation(copy);
			endEveryProof(copy);
			marks.restored(from.id, from.capturedAt, now);
		})();

		const mode = copy.pragma("journal_mode = DELETE", { simple: true });
		if (mode !== "delete") throw new Error(`could not leave WAL for the copy: ${String(mode)}`);
	} finally {
		copy.close();
	}
	if (existsSync(`${files.staged}-wal`)) throw new Error("the copy kept a WAL after closing");
}

/**
 * Keeps the previous set of files and publishes the marker. The previous set is hard-linked, without opening it, so
 * it works the same with a database sound, damaged or missing; each link, the new folder and the data folder are
 * synced. Then the marker is written as a draft, synced, renamed and the data folder synced: it is on disk whole or
 * not at all.
 */
async function publish(
	files: Files,
	staged: Staged,
	now: number,
	cut: RestoreRuntime["cut"],
): Promise<Marker> {
	const preserved = `before-restore-${compactInstant(now)}`;
	const folder = join(files.dataDir, preserved);
	mkdirSync(folder);
	for (const path of [files.database, ...files.auxiliaries]) {
		if (!existsSync(path)) continue;
		const link = join(folder, basename(path));
		linkSync(path, link);
		syncToDisk(link);
	}
	syncToDisk(folder);
	syncToDisk(files.dataDir);

	// The staged copy is already synced: staging did it before returning.
	const marker: Marker = { preserved, ...staged, at: now };
	const draft = openSync(files.draft, "w");
	try {
		writeSync(draft, JSON.stringify(marker));
		fsyncSync(draft);
	} finally {
		closeSync(draft);
	}
	await cut?.("marker-written");
	renameSync(files.draft, files.marker);
	syncToDisk(files.dataDir);
	await cut?.("marker-published");
	return marker;
}

/**
 * Installs the staged copy with the marker on disk: removes the old auxiliary files, renames the copy over the
 * database and removes the marker, syncing each step. Resuming runs it again with the marker found: the staged copy
 * still in its folder means the rename is missing; gone, only the syncs and the marker's removal are left.
 */
async function install(files: Files, marker: Marker, cut: RestoreRuntime["cut"]): Promise<void> {
	// The marker is on disk: SQLite never checks that a WAL is its database's, so none may outlive the exchange.
	for (const path of files.auxiliaries) rmSync(path, { force: true });
	syncToDisk(files.dataDir);
	await cut?.("auxiliaries-removed");

	if (existsSync(files.staged)) {
		renameSync(files.staged, files.database);
		await cut?.("database-renamed");
	} else if (!existsSync(files.database)) {
		throw new Error(
			`the staged copy of ${marker.snapshot} is gone and no database is installed`,
		);
	}
	if (existsSync(files.staging)) syncToDisk(files.staging);
	syncToDisk(files.dataDir);
	await cut?.("database-installed");

	rmSync(files.marker);
	syncToDisk(files.dataDir);
}

/**
 * The marker of a restore that has not ended, or undefined when there is none. One that exists but cannot be read
 * throws: it is never taken for absent.
 */
function readMarker(dataDir: string): Marker | undefined {
	let text: string;
	try {
		text = readFileSync(join(dataDir, MARKER), "utf8");
	} catch (error) {
		if (errorCode(error) === "ENOENT") return undefined;
		throw new Error("restore marker unreadable");
	}
	try {
		const marker = JSON.parse(text) as Partial<Marker>;
		if (
			typeof marker.preserved === "string" &&
			/^before-restore-[0-9TZ]+$/.test(marker.preserved) &&
			typeof marker.snapshot === "string" &&
			typeof marker.capturedAt === "number" &&
			typeof marker.at === "number"
		)
			return marker as Marker;
	} catch {
		// Not JSON: unreadable as well.
	}
	throw new Error("restore marker unreadable");
}

/**
 * Throws when a restore has not ended in the data folder: opening the platform runs it after the shared lock and
 * before the database. A marker that cannot be read throws too, with its own message.
 */
export function refuseWhileRestorePending(dataDir: string): void {
	if (readMarker(dataDir)) throw new Error("restore incomplete: run restore again");
}

/** An instant in UTC, compact for a folder's name: `20260101T040000Z`. */
function compactInstant(instant: number): string {
	return new Date(instant)
		.toISOString()
		.replace(/\.\d+Z$/, "Z")
		.replace(/[-:]/g, "");
}

/** Writes a file's data to disk or, for a folder, its entries: what was created, renamed or removed in it. */
function syncToDisk(path: string): void {
	const handle = openSync(path, "r");
	try {
		fsyncSync(handle);
	} finally {
		closeSync(handle);
	}
}

/** A signal nobody aborts: restoring is not a job, and nothing cancels its restic. */
function never(): AbortSignal {
	return new AbortController().signal;
}

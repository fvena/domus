// Restoring a backup (ADR 0026): a function of the platform, without an actor and without actions, that the command
// `restore.mjs` of `apps/api` composes. It runs only with the database free: it holds the exclusive lock for the
// whole procedure, or refuses. It stages the snapshot apart, in a fixed staging folder of the data folder (checked,
// migrated and sanitized), and installs it with an exchange that, cut anywhere, leaves the previous database whole or
// the restored one sanitized. A marker published before the first auxiliary file goes keeps the platform from
// opening until running restore again ends the procedure.
//
// The file contents the restored copy needs come with it (ADR 0028): checked by their hash while staging, and
// installed into the live store by a rename that overwrites, each synced, before the marker is published. A cut
// before the marker repeats the staging; what it installed are orphans for the cleanup, since restoring never
// deletes a live content.
//
// Invariants, each kept where its step is:
// - the staged copy is synced to disk before the marker is published;
// - every content the restored copy needs is installed and synced before the marker is published;
// - the exclusive lock lasts the whole procedure, resuming included;
// - while the marker exists, nothing empties the staging folder of restoring nor creates another `before-restore`;
// - from the first removal of an auxiliary file on, the marker is already on disk.
import { createHash } from "node:crypto";
import {
	closeSync,
	existsSync,
	fsyncSync,
	linkSync,
	mkdirSync,
	openSync,
	readFileSync,
	readSync,
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
import { dropUnneededFiles, NEEDED_CONTENTS } from "../files/needed";
import {
	CONTENT_HASH,
	createFileStore,
	type FileStore,
	filesFolderOf,
	syncToDisk,
} from "../files/store";
import { endSessions } from "../identity/sessions";
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
import { emptyFolder, SNAPSHOT_FILE, STAGED_FILES } from "./staging";

/** The staging folder of restoring, inside the data folder. */
const STAGING = "restore-staging";
/** How much of a staged content is read at a time to check its hash. */
const HASH_CHUNK = 1024 * 1024;
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
	/**
	 * The `files` folder of the store of file contents, an absolute path on the same volume as the data folder:
	 * `files` in the data folder unless given, as the platform has it.
	 */
	readonly filesDirectory?: string;
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
	/** One content the restored copy needs installed in the live store and synced; called once for each. */
	| "content-installed"
	/** Every content the restored copy needs installed and synced, before keeping the previous set. */
	| "contents-installed"
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
	{ databaseFile, filesDirectory, modules, backups, snapshot }: RestoreOptions,
	runtime: RestoreRuntime,
): Promise<RestoreResult> {
	const { clock, cut } = runtime;
	if (!isAbsolute(databaseFile))
		throw new Error(`databaseFile must be an absolute path, got "${databaseFile}"`);
	if (filesDirectory !== undefined && !isAbsolute(filesDirectory))
		throw new Error(`filesDirectory must be an absolute path, got "${filesDirectory}"`);
	// The same check as opening the platform, before anything of the data folder is touched.
	checkModules(modules);
	const dataDir = dirname(databaseFile);
	const paths = restorePathsOf(databaseFile, filesFolderOf(databaseFile, filesDirectory));
	// Held, and referenced, until the end: the garbage collector would close an unreachable connection, and its lock.
	const lock = takeExclusiveLock(dataDir);
	try {
		const pending = readMarker(dataDir);
		if (pending) {
			await install(paths, pending, cut);
			return { ...result(paths, pending), resumed: true };
		}

		const staged = await stage(
			paths,
			modules,
			resticOf(backups, runtime),
			snapshot,
			clock,
			cut,
		);
		const marker = await publish(paths, staged, clock(), cut);
		await install(paths, marker, cut);
		return { ...result(paths, marker), resumed: false };
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
interface RestorePaths {
	readonly dataDir: string;
	readonly database: string;
	/** The live database's `-wal` and `-shm`. */
	readonly auxiliaries: readonly string[];
	readonly staging: string;
	/** The staged copy, in the staging folder. */
	readonly staged: string;
	/** The staged contents, under the staging folder as the store lays them out. */
	readonly stagedContents: FileStore;
	/** The live store of file contents. */
	readonly contents: FileStore;
	readonly marker: string;
	readonly draft: string;
}

function restorePathsOf(databaseFile: string, filesDirectory: string): RestorePaths {
	const dataDir = dirname(databaseFile);
	const staging = join(dataDir, STAGING);
	return {
		dataDir,
		database: databaseFile,
		auxiliaries: [`${databaseFile}-wal`, `${databaseFile}-shm`],
		staging,
		staged: join(staging, SNAPSHOT_FILE),
		stagedContents: createFileStore(join(staging, STAGED_FILES)),
		contents: createFileStore(filesDirectory),
		marker: join(dataDir, MARKER),
		draft: join(dataDir, MARKER_DRAFT),
	};
}

function result(paths: RestorePaths, marker: Marker): Omit<RestoreResult, "resumed"> {
	return {
		snapshot: marker.snapshot,
		capturedAt: marker.capturedAt,
		preserved: join(paths.dataDir, marker.preserved),
	};
}

/** What staging leaves: the copy synced in the staging folder, and where it came from. */
interface Staged {
	readonly snapshot: string;
	readonly capturedAt: number;
}

/**
 * Stages the snapshot apart: restic leaves it and its contents in the emptied staging folder, `quick_check` passes,
 * its migrations are an exact prefix of the code's and the missing ones are applied, every content it needs matches
 * its hash, it is sanitized in one transaction, and it is closed without a WAL and synced with its folder. Then the
 * contents it needs go into the live store. Any failure empties the staging folder and leaves the live database
 * untouched: no marker exists yet. Nor does it ever delete a live content.
 */
async function stage(
	paths: RestorePaths,
	modules: readonly ModuleDefinition[],
	restic: Restic,
	wanted: string | undefined,
	clock: Clock,
	cut: RestoreRuntime["cut"],
): Promise<Staged> {
	// No marker exists here, so emptying the staging folder and dropping a draft that was never published is safe.
	rmSync(paths.draft, { force: true });
	emptyFolder(paths.staging);
	try {
		const found = await chosenSnapshot(restic, wanted);
		const { code } = await restic.run(
			[
				"restore",
				found.id,
				"--target",
				paths.staging,
				"--include",
				`/${SNAPSHOT_FILE}`,
				"--include",
				`/${STAGED_FILES}`,
				...RETRY_LOCK,
			],
			never(),
		);
		if (code !== 0) throw new Error(resticExited("restore", code));
		if (!existsSync(paths.staged)) throw new Error("the snapshot holds no domus.db");

		const needed = sanitizeCopy(paths, modules, found, clock());
		syncToDisk(paths.staged);
		syncToDisk(paths.staging);
		await installContents(paths, needed, cut);
		return { snapshot: found.id, capturedAt: found.capturedAt };
	} catch (error) {
		emptyFolder(paths.staging);
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
 * Checks, migrates and sanitizes the copy in the staging folder, and closes it in `DELETE` mode, without a WAL; it
 * returns the hashes of the contents the copy needs at `now`. The migrations are validated and applied as
 * createPlatform does: a copy newer than the code, or a migration that fails, stops here with the migrator's
 * message. Each content the copy needs must be staged and match its hash before anything is sanitized.
 */
function sanitizeCopy(
	paths: RestorePaths,
	modules: readonly ModuleDefinition[],
	from: SnapshotSummary,
	now: number,
): readonly string[] {
	let needed: readonly string[];
	const copy = new Database(paths.staged, { fileMustExist: true });
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

		needed = copy
			.prepare<[number], { hash: string }>(NEEDED_CONTENTS)
			.all(now)
			.map(({ hash }) => hash);
		for (const hash of needed) checkStaged(paths.stagedContents, hash);

		const marks = createMarkStore(copy);
		copy.transaction(() => {
			// Nothing of the copy repeats a notice or an effect that already went out; a normal restart still recovers.
			discardUnfinishedJobs(copy, now, DISCARDED);
			// The tasks the platform declares with the backups on, each one's next run from its frequency.
			rescheduleTasks(copy, () => now, BACKUP_SCHEDULES);
			// A session revoked, or a password changed, after the copy must not come back.
			endSessions(copy, { every: true });
			endEveryConfirmation(copy);
			endEveryProof(copy);
			// No prepared file serves once every session ended, and the contents left are exactly the needed ones.
			dropUnneededFiles(copy, now);
			marks.restored(from.id, from.capturedAt, now);
		})();

		const mode = copy.pragma("journal_mode = DELETE", { simple: true });
		if (mode !== "delete") throw new Error(`could not leave WAL for the copy: ${String(mode)}`);
	} finally {
		copy.close();
	}
	if (existsSync(`${paths.staged}-wal`)) throw new Error("the copy kept a WAL after closing");
	return needed;
}

/** Throws unless the staged content of `hash` exists and its bytes have that SHA-256. */
function checkStaged(staged: FileStore, hash: string): void {
	if (!CONTENT_HASH.test(hash))
		throw new Error("the backup names a file content by an invalid hash");
	let handle: number;
	try {
		handle = openSync(staged.contentPath(hash), "r");
	} catch (error) {
		if (errorCode(error) === "ENOENT")
			throw new Error("the backup lacks a file content its database needs");
		throw error;
	}
	try {
		const digest = createHash("sha256");
		const chunk = Buffer.alloc(HASH_CHUNK);
		for (let read = readSync(handle, chunk); read > 0; read = readSync(handle, chunk))
			digest.update(chunk.subarray(0, read));
		if (digest.digest("hex") !== hash)
			throw new Error("a file content of the backup does not match its hash");
	} finally {
		closeSync(handle);
	}
}

/**
 * Installs each content the restored copy needs from the staging folder into the live store: synced, renamed over
 * whatever the store holds by that name, so a damaged live file is mended without reading it, and its folder
 * synced. It never removes a live content.
 */
async function installContents(
	paths: RestorePaths,
	needed: readonly string[],
	cut: RestoreRuntime["cut"],
): Promise<void> {
	for (const hash of needed) {
		const staged = paths.stagedContents.contentPath(hash);
		syncToDisk(staged);
		paths.contents.install(hash, staged);
		await cut?.("content-installed");
	}
	await cut?.("contents-installed");
}

/**
 * Keeps the previous set of files and publishes the marker. The previous set is hard-linked, without opening it, so
 * it works the same with a database sound, damaged or missing; each link, the new folder and the data folder are
 * synced. Then the marker is written as a draft, synced, renamed and the data folder synced: it is on disk whole or
 * not at all.
 */
async function publish(
	paths: RestorePaths,
	staged: Staged,
	now: number,
	cut: RestoreRuntime["cut"],
): Promise<Marker> {
	const preserved = `before-restore-${compactInstant(now)}`;
	const folder = join(paths.dataDir, preserved);
	mkdirSync(folder);
	for (const path of [paths.database, ...paths.auxiliaries]) {
		if (!existsSync(path)) continue;
		const link = join(folder, basename(path));
		linkSync(path, link);
		syncToDisk(link);
	}
	syncToDisk(folder);
	syncToDisk(paths.dataDir);

	// The staged copy is already synced: staging did it before returning.
	const marker: Marker = { preserved, ...staged, at: now };
	const draft = openSync(paths.draft, "w");
	try {
		writeSync(draft, JSON.stringify(marker));
		fsyncSync(draft);
	} finally {
		closeSync(draft);
	}
	await cut?.("marker-written");
	renameSync(paths.draft, paths.marker);
	syncToDisk(paths.dataDir);
	await cut?.("marker-published");
	return marker;
}

/**
 * Installs the staged copy with the marker on disk: removes the old auxiliary files, renames the copy over the
 * database and removes the marker, syncing each step. Resuming runs it again with the marker found: the staged copy
 * still in its folder means the rename is missing; gone, only the syncs and the marker's removal are left.
 */
async function install(
	paths: RestorePaths,
	marker: Marker,
	cut: RestoreRuntime["cut"],
): Promise<void> {
	// The marker is on disk: SQLite never checks that a WAL is its database's, so none may outlive the exchange.
	for (const path of paths.auxiliaries) rmSync(path, { force: true });
	syncToDisk(paths.dataDir);
	await cut?.("auxiliaries-removed");

	if (existsSync(paths.staged)) {
		renameSync(paths.staged, paths.database);
		await cut?.("database-renamed");
	} else if (!existsSync(paths.database)) {
		throw new Error(
			`the staged copy of ${marker.snapshot} is gone and no database is installed`,
		);
	}
	if (existsSync(paths.staging)) syncToDisk(paths.staging);
	syncToDisk(paths.dataDir);
	await cut?.("database-installed");

	rmSync(paths.marker);
	syncToDisk(paths.dataDir);
	// The marker is gone: what the staging folder still holds, contents the copy no longer needed, goes too.
	emptyFolder(paths.staging);
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

/** A signal nobody aborts: restoring is not a job, and nothing cancels its restic. */
function never(): AbortSignal {
	return new AbortController().signal;
}

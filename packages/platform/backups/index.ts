// Backups (ADR 0026, which narrows ADR 0025): maintenance of the platform, without actions and without an actor.
// The `backup` task takes a snapshot of the database into a fixed staging folder of the data folder, checks it in a
// child process, saves it with restic into an encrypted repository and marks it saved, then applies the retention
// and marks its result. A failed attempt is marked too. A cancelled job aborts the snapshot or ends the child that
// runs, and the staging folder is emptied at the start and at the end of every run. The weekly `backup-check` reads
// the whole repository and marks its result. The marks feed the watcher of `/health`. module-sdk offers none of
// this, and a dependency rule keeps modules out.
import { readdirSync } from "node:fs";
import { join } from "node:path";

import type Database from "better-sqlite3";

import type { Clock } from "../actions";
import {
	type BackupReason,
	type BackupsWatch,
	PermanentJobError,
	type ScheduledTask,
	type TaskSchedule,
	type Timer,
} from "../background";
import { type BackupMarks, createMarkStore } from "./marks";
import {
	type BackupConfig,
	createRestic,
	HOST,
	REPOSITORY_LOCKED,
	REPOSITORY_MISSING,
	type Restic,
	resticExited,
	ResticLockedError,
} from "./restic";
import { passesQuickCheck, takeSnapshot } from "./snapshot";
import { emptyFolder, SNAPSHOT_FILE } from "./staging";

export type { BackupConfig } from "./restic";
export type { BackupMarks } from "./marks";

export const BACKUP_TASK = "backup";
export const BACKUP_CHECK_TASK = "backup-check";

/** The nightly backup at 05:00, and the weekly check on Sunday at 05:30. */
export const BACKUP_SCHEDULES = [
	{ id: BACKUP_TASK, frequency: { every: "day", at: "05:00" } },
	{ id: BACKUP_CHECK_TASK, frequency: { every: "week", on: "sunday", at: "05:30" } },
] as const satisfies readonly TaskSchedule[];
const [BACKUP_SCHEDULE, BACKUP_CHECK_SCHEDULE] = BACKUP_SCHEDULES;

/** The staging folder of the backups, inside the data folder. */
const STAGING = "backup-staging";
/** How long after its capture the last saved backup stays fresh for the watcher. */
const STALE_AFTER = 48 * 60 * 60 * 1000;
/**
 * What the retention keeps of host `domus`, as one group whatever path the snapshots had (restic groups by host and
 * paths unless told), and the prune of what it forgets. It waits up to 10 min for a lock another process holds, such
 * as the shared one of the rehearsal's restore: only a lock still held after that fails it.
 */
const RETENTION = [
	"--retry-lock",
	"10m",
	"--group-by",
	"host",
	"--keep-daily",
	"7",
	"--keep-weekly",
	"4",
	"--keep-monthly",
	"3",
	"--prune",
];

export interface BackupsOptions {
	readonly connection: Database.Database;
	readonly clock: Clock;
	/** The platform's timer: how long a child that ignores SIGTERM has before SIGKILL. */
	readonly timer: Timer;
	readonly config: BackupConfig;
	/** The folder of the live database, where the staging folder lives. */
	readonly dataDir: string;
	/** The restic executable: `restic` from the `PATH` unless the testing entry gives another. */
	readonly executable?: string;
}

/** The backups' tasks and what the watcher reads of their marks. The marks load now. */
export function createBackups({
	connection,
	clock,
	timer,
	config,
	dataDir,
	executable = "restic",
}: BackupsOptions): BackupsWatch {
	const marks = createMarkStore(connection);
	const clockAndTimer = { clock, timer };
	const restic = createRestic(executable, config, clockAndTimer);
	const staging = join(dataDir, STAGING);

	/** The nightly backup, in the maintenance lane. */
	const backupTask: ScheduledTask = {
		...BACKUP_SCHEDULE,
		job: {
			lane: "maintenance",
			async run({ signal }) {
				// What a crash in the middle of a run left goes now.
				emptyFolder(staging);
				try {
					const file = join(staging, SNAPSHOT_FILE);
					try {
						await takeSnapshot(connection, file, signal);
						// The data is the database's as the copy ended.
						const capturedAt = clock();
						if (!(await passesQuickCheck(file, signal, clockAndTimer)))
							throw new PermanentJobError("the snapshot failed quick_check");
						await unlock(restic, signal);
						const snapshot = await save(restic, config, staging, capturedAt, signal);
						marks.saved(capturedAt, snapshot);
					} catch (error) {
						marks.failed(clock());
						throw error;
					}
					// A failed retention fails the run without a retry: the backup is saved, and repeating it would
					// only add a snapshot. The next night tries again.
					const { code } = await restic.run(
						["forget", "--host", HOST, ...RETENTION],
						signal,
					);
					marks.retention(clock(), code === 0 ? "ok" : "failed");
					if (code !== 0) throw new PermanentJobError(resticExited("forget", code));
				} finally {
					emptyFolder(staging);
				}
			},
		},
	};

	/**
	 * The weekly check, in the maintenance lane: restic reads the whole repository. A repository
	 * that does not exist yet has nothing to check, and its mark stays. A live lock is retried; any failure for good,
	 * also one that used up its attempts, marks the check failed.
	 */
	const checkTask: ScheduledTask = {
		...BACKUP_CHECK_SCHEDULE,
		job: {
			lane: "maintenance",
			async run({ signal }) {
				if (!(await unlock(restic, signal))) return;
				const { code } = await restic.run(["check", "--read-data"], signal);
				if (code === REPOSITORY_MISSING) return;
				if (code !== 0) throw resticFailure("check", code);
				marks.check(clock(), "ok");
			},
			failed: (at) => marks.check(at, "failed"),
		},
	};

	return {
		tasks: [backupTask, checkTask],
		health: () => watch(marks.current(), clock()),
	};
}

/** What the watcher reads of the marks at `now`. */
function watch(
	{ saved, failedAt, retention, check }: BackupMarks,
	now: number,
): ReturnType<BackupsWatch["health"]> {
	const reasons: BackupReason[] = [];
	if (saved === null ? failedAt !== null : now - saved.capturedAt > STALE_AFTER)
		reasons.push("backup-stale");
	if (retention?.result === "failed") reasons.push("backup-retention-failed");
	if (check?.result === "failed") reasons.push("backup-check-failed");
	const state = saved !== null ? "saved" : failedAt === null ? "none-yet" : "none";
	return { state, reasons };
}

/**
 * Removes the repository's stale locks, never a live one, and tells whether the repository exists. One that does
 * not exist yet is for the caller to decide: `save` may initialize it, and the check has nothing to read.
 */
async function unlock(restic: Restic, signal: AbortSignal): Promise<boolean> {
	const { code } = await restic.run(["unlock"], signal);
	if (code === REPOSITORY_MISSING) return false;
	if (code !== 0) throw resticFailure("unlock", code);
	return true;
}

/**
 * Saves the staging folder's snapshot with restic, its time the capture instant, and returns the snapshot's id. A
 * repository that does not exist is created only when its folder exists and is empty: a missing folder, or one with
 * anything in it, is never initialized.
 */
async function save(
	restic: Restic,
	config: BackupConfig,
	staging: string,
	capturedAt: number,
	signal: AbortSignal,
): Promise<string> {
	const args = [
		"backup",
		"--json",
		"--host",
		HOST,
		"--time",
		resticTime(capturedAt),
		SNAPSHOT_FILE,
	];
	let backup = await restic.run(args, signal, staging);
	if (backup.code === REPOSITORY_MISSING && isEmptyFolder(config.repository)) {
		const init = await restic.run(["init"], signal);
		if (init.code !== 0) throw resticFailure("init", init.code);
		backup = await restic.run(args, signal, staging);
	}
	// Code 3, a source restic could not read whole, leaves a partial snapshot: it is no saved backup.
	if (backup.code !== 0) throw resticFailure("backup", backup.code);
	const snapshot = snapshotIdOf(backup.stdout);
	if (snapshot === undefined) throw new PermanentJobError("restic backup gave no snapshot id");
	return snapshot;
}

/**
 * The error of a restic step that did not exit with `0`: passing when another process holds the repository's lock,
 * so the engine retries it, else permanent. Either keeps only the step and the code, never restic's output.
 */
function resticFailure(step: string, code: number): Error {
	if (code === REPOSITORY_LOCKED) return new ResticLockedError(step);
	return new PermanentJobError(resticExited(step, code));
}

/** The id in the summary line of `restic backup --json`. */
function snapshotIdOf(stdout: string): string | undefined {
	for (const line of stdout.split("\n").reverse()) {
		try {
			const message = JSON.parse(line) as { message_type?: unknown; snapshot_id?: unknown };
			if (message.message_type === "summary" && typeof message.snapshot_id === "string")
				return message.snapshot_id;
		} catch {
			// Not a line of JSON: restic's progress may share the output.
		}
	}
	return undefined;
}

/** An instant as restic's `--time` reads it, `YYYY-MM-DD HH:MM:SS`, in UTC: restic runs with `TZ=UTC`. */
function resticTime(instant: number): string {
	return new Date(instant).toISOString().slice(0, 19).replace("T", " ");
}

/** True when the folder exists and holds nothing. */
function isEmptyFolder(folder: string): boolean {
	try {
		return readdirSync(folder).length === 0;
	} catch {
		return false;
	}
}

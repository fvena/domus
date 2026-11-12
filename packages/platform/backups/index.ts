// Backups (ADR 0026, which narrows ADR 0025): maintenance of the platform, without actions and without an actor.
// The `backup` task takes a snapshot of the database into a fixed staging folder of the data folder, checks it in a
// child process and saves it with restic into an encrypted repository, then marks it saved. The marks feed the
// watcher of `/health`. module-sdk offers none of this, and a dependency rule keeps modules out.
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import type Database from "better-sqlite3";

import type { Clock } from "../actions";
import { type BackupsWatch, PermanentJobError, type ScheduledTask } from "../background";
import { createMarkStore, type MarkStore } from "./marks";
import { type BackupConfig, REPOSITORY_MISSING, type Restic, restic } from "./restic";
import { passesQuickCheck } from "./snapshot";

export type { BackupConfig } from "./restic";
export type { BackupMarks } from "./marks";

export const BACKUP_TASK = "backup";

/** The staging folder of the backups, inside the data folder. */
const STAGING = "backup-staging";
/** The snapshot's name, in the staging folder and in each restic snapshot, at its root. */
const SNAPSHOT_FILE = "domus.db";
/** The host of every snapshot, fixed so the retention groups them whatever the container is called. */
const HOST = "domus";

export interface BackupsOptions {
	readonly connection: Database.Database;
	readonly clock: Clock;
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
	config,
	dataDir,
	executable = "restic",
}: BackupsOptions): BackupsWatch {
	const marks = createMarkStore(connection);
	const repository = restic(executable, config);
	return {
		tasks: [backupTask({ connection, clock, config, dataDir, marks, repository })],
		health: () => ({
			state: marks.current().saved === null ? "none-yet" : "saved",
			reasons: [],
		}),
	};
}

interface BackupTaskOptions {
	readonly connection: Database.Database;
	readonly clock: Clock;
	readonly config: BackupConfig;
	readonly dataDir: string;
	readonly marks: MarkStore;
	readonly repository: Restic;
}

/** The nightly backup, at 05:00 in the maintenance lane. */
function backupTask({
	connection,
	clock,
	config,
	dataDir,
	marks,
	repository,
}: BackupTaskOptions): ScheduledTask {
	const staging = join(dataDir, STAGING);
	return {
		id: BACKUP_TASK,
		frequency: { every: "day", at: "05:00" },
		job: {
			lane: "maintenance",
			async run() {
				emptyFolder(staging);
				try {
					const file = join(staging, SNAPSHOT_FILE);
					await connection.backup(file);
					// The data is the database's as the copy ended.
					const capturedAt = clock();
					if (!(await passesQuickCheck(file)))
						throw new PermanentJobError("the snapshot failed quick_check");
					const snapshot = await save(repository, config, staging, capturedAt);
					marks.saved(capturedAt, snapshot);
				} finally {
					emptyFolder(staging);
				}
			},
		},
	};
}

/**
 * Saves the staging folder's snapshot with restic, its time the capture instant, and returns the snapshot's id. A
 * repository that does not exist is created only when its folder exists and is empty.
 */
async function save(
	repository: Restic,
	config: BackupConfig,
	staging: string,
	capturedAt: number,
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
	let backup = await repository.run(args, staging);
	if (backup.code === REPOSITORY_MISSING && isEmptyFolder(config.repository)) {
		const init = await repository.run(["init"]);
		if (init.code !== 0)
			throw new PermanentJobError(`restic init exited with code ${init.code}`);
		backup = await repository.run(args, staging);
	}
	if (backup.code !== 0)
		throw new PermanentJobError(`restic backup exited with code ${backup.code}`);
	const snapshot = snapshotIdOf(backup.stdout);
	if (snapshot === undefined) throw new PermanentJobError("restic backup gave no snapshot id");
	return snapshot;
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

/** Removes the folder with whatever it holds and creates it again, empty. */
function emptyFolder(folder: string): void {
	rmSync(folder, { recursive: true, force: true });
	mkdirSync(folder, { recursive: true });
}

/** True when the folder exists and holds nothing. */
function isEmptyFolder(folder: string): boolean {
	try {
		return readdirSync(folder).length === 0;
	} catch {
		return false;
	}
}

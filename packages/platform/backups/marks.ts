// The backups' marks (ADR 0026): one row of `platform_backup_marks`, loaded when the platform opens and kept in
// memory as each mark is written, so the watcher of `/health` never reads the database.
import type Database from "better-sqlite3";

export type MarkResult = "ok" | "failed";

/** What the backups left behind. Each part is null until its first mark. */
export interface BackupMarks {
	/** The last saved backup: when its data was captured and the id of its snapshot. */
	readonly saved: { readonly capturedAt: number; readonly snapshot: string } | null;
	/** The instant of the last failed attempt at a backup. */
	readonly failedAt: number | null;
	readonly retention: { readonly at: number; readonly result: MarkResult } | null;
	readonly check: { readonly at: number; readonly result: MarkResult } | null;
	/** Where the last restore came from. */
	readonly restored: {
		readonly snapshot: string;
		readonly capturedAt: number;
		readonly at: number;
	} | null;
}

export interface MarkStore {
	/** The marks as the row holds them now. */
	current(): BackupMarks;
	/** Marks a saved backup: the instant its data was captured and its snapshot's id. */
	saved(capturedAt: number, snapshot: string): void;
	/** Marks a failed attempt at a backup, one that saved nothing. */
	failed(at: number): void;
	/** Marks the end of a retention and its result. */
	retention(at: number, result: MarkResult): void;
	/**
	 * Marks where a restore came from: its snapshot, the instant its data was captured and the instant of restoring.
	 * The saved backup becomes that snapshot only when its capture is newer than the one the copy had: restoring
	 * never makes the backups younger. The `check` stays as the copy had it.
	 */
	restored(snapshot: string, capturedAt: number, at: number): void;
}

interface MarksRow {
	readonly saved_captured_at: number | null;
	readonly saved_snapshot: string | null;
	readonly failed_at: number | null;
	readonly retention_at: number | null;
	readonly retention_result: MarkResult | null;
	readonly check_at: number | null;
	readonly check_result: MarkResult | null;
	readonly restored_snapshot: string | null;
	readonly restored_captured_at: number | null;
	readonly restored_at: number | null;
}

/** Loads the marks now and keeps them in memory, written through to their row. */
export function createMarkStore(connection: Database.Database): MarkStore {
	let marks = toMarks(
		connection.prepare<[], MarksRow>("SELECT * FROM platform_backup_marks WHERE id = 1").get(),
	);
	const writeSaved = connection.prepare<[number, string]>(
		`INSERT INTO platform_backup_marks (id, saved_captured_at, saved_snapshot) VALUES (1, ?, ?)
			ON CONFLICT (id) DO UPDATE SET saved_captured_at = excluded.saved_captured_at,
				saved_snapshot = excluded.saved_snapshot`,
	);
	const writeFailed = connection.prepare<[number]>(
		`INSERT INTO platform_backup_marks (id, failed_at) VALUES (1, ?)
			ON CONFLICT (id) DO UPDATE SET failed_at = excluded.failed_at`,
	);
	const writeRetention = connection.prepare<[number, MarkResult]>(
		`INSERT INTO platform_backup_marks (id, retention_at, retention_result) VALUES (1, ?, ?)
			ON CONFLICT (id) DO UPDATE SET retention_at = excluded.retention_at,
				retention_result = excluded.retention_result`,
	);
	const writeRestored = connection.prepare<[string, number, number]>(
		`INSERT INTO platform_backup_marks (id, restored_snapshot, restored_captured_at, restored_at)
			VALUES (1, ?, ?, ?)
			ON CONFLICT (id) DO UPDATE SET restored_snapshot = excluded.restored_snapshot,
				restored_captured_at = excluded.restored_captured_at, restored_at = excluded.restored_at`,
	);

	return {
		current: () => marks,
		saved(capturedAt, snapshot) {
			writeSaved.run(capturedAt, snapshot);
			marks = { ...marks, saved: { capturedAt, snapshot } };
		},
		failed(at) {
			writeFailed.run(at);
			marks = { ...marks, failedAt: at };
		},
		retention(at, result) {
			writeRetention.run(at, result);
			marks = { ...marks, retention: { at, result } };
		},
		restored(snapshot, capturedAt, at) {
			writeRestored.run(snapshot, capturedAt, at);
			marks = { ...marks, restored: { snapshot, capturedAt, at } };
			if (marks.saved === null || marks.saved.capturedAt < capturedAt) {
				writeSaved.run(capturedAt, snapshot);
				marks = { ...marks, saved: { capturedAt, snapshot } };
			}
		},
	};
}

function toMarks(row: MarksRow | undefined): BackupMarks {
	if (!row) return { saved: null, failedAt: null, retention: null, check: null, restored: null };
	return {
		saved:
			row.saved_captured_at === null || row.saved_snapshot === null
				? null
				: { capturedAt: row.saved_captured_at, snapshot: row.saved_snapshot },
		failedAt: row.failed_at,
		retention:
			row.retention_at === null || row.retention_result === null
				? null
				: { at: row.retention_at, result: row.retention_result },
		check:
			row.check_at === null || row.check_result === null
				? null
				: { at: row.check_at, result: row.check_result },
		restored:
			row.restored_snapshot === null ||
			row.restored_captured_at === null ||
			row.restored_at === null
				? null
				: {
						snapshot: row.restored_snapshot,
						capturedAt: row.restored_captured_at,
						at: row.restored_at,
					},
	};
}

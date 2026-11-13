// The file contents a database needs at an instant (ADR 0028, spec of phase 1d3, «Copia»): those of its live
// references and of its released ones whose entry is still undoable then, not undone and not yet expired. A
// prepared file is not among them. The backup reads it from its snapshot at the capture instant; restoring needs
// the same of the copy it restores.
import type Database from "better-sqlite3";

/**
 * The hashes of the contents a database needs at the instant of its one parameter, each once, in order. A released
 * reference's protection is its entry's own `expires_at`, never the retention configured now.
 */
export const NEEDED_CONTENTS = `SELECT DISTINCT r.content AS hash
	FROM platform_file_references r
	LEFT JOIN platform_action_log l ON l.entry = r.released_by
	WHERE r.released_by IS NULL OR (l.undone_by IS NULL AND l.expires_at > ?)
	ORDER BY r.content`;

/** A content's hash as the store names it: SHA-256 in lowercase hex. */
export const CONTENT_HASH = /^[0-9a-f]{64}$/;

/**
 * Drops what a restored copy no longer needs of its files at `now`, inside the caller's transaction (spec of phase
 * 1d3, «Restaurar»): every prepared file, since the restore ended its session; the released references whose entry
 * is undone or expired, as the cleanup would; and then the content rows nothing points to any longer, whose bytes
 * the backup did not carry. What is left is exactly {@link NEEDED_CONTENTS} at `now`.
 */
export function dropUnneededFiles(connection: Database.Database, now: number): void {
	connection.prepare("DELETE FROM platform_prepared_files").run();
	connection
		.prepare(
			`DELETE FROM platform_file_references WHERE id IN (
				SELECT r.id FROM platform_file_references r
					JOIN platform_action_log l ON l.entry = r.released_by
				WHERE l.undone_by IS NOT NULL OR l.expires_at <= ?)`,
		)
		.run(now);
	connection
		.prepare(
			`DELETE FROM platform_file_contents WHERE NOT EXISTS (
				SELECT 1 FROM platform_file_references r WHERE r.content = platform_file_contents.hash)`,
		)
		.run();
}

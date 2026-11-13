// The file contents a database needs at an instant (ADR 0028, spec of phase 1d3, «Copia»): those of its live
// references and of its released ones whose entry is still undoable then, not undone and not yet expired. A
// prepared file is not among them. The backup reads it from its snapshot at the capture instant; restoring needs
// the same of the copy it restores.
import type Database from "better-sqlite3";

/**
 * The ids of the released references that no longer protect their content at the instant of its one parameter:
 * their entry was undone or expired. The one form of that rule, for the cleanup, for restoring and, as what is
 * left out, for {@link NEEDED_CONTENTS}. A released reference's protection is its entry's own `expires_at`, never
 * the retention configured now.
 */
export const RELEASES_ENDED = `SELECT reference.id FROM platform_file_references AS reference
	JOIN platform_action_log AS released ON released.entry = reference.released_by
	WHERE released.undone_by IS NOT NULL OR released.expires_at <= ?`;

/**
 * The hashes of the contents a database needs at the instant of its one parameter, each once, in order: those of
 * its live references and of its released ones still protected then.
 */
export const NEEDED_CONTENTS = `SELECT DISTINCT content AS hash FROM platform_file_references
	WHERE id NOT IN (${RELEASES_ENDED})
	ORDER BY content`;

/** A content's hash as the store names it: SHA-256 in lowercase hex. */
export const CONTENT_HASH = /^[0-9a-f]{64}$/;

/**
 * Drops what a restored copy no longer needs of its files at `now`, inside the caller's transaction (spec of phase
 * 1d3, «Restaurar»): every prepared file, since the restore ended its session; the released references that no
 * longer protect, as the cleanup would; and then the content rows nothing points to any longer, whose bytes
 * the backup did not carry. What is left is exactly {@link NEEDED_CONTENTS} at `now`.
 */
export function dropUnneededFiles(connection: Database.Database, now: number): void {
	connection.prepare("DELETE FROM platform_prepared_files").run();
	connection
		.prepare(`DELETE FROM platform_file_references WHERE id IN (${RELEASES_ENDED})`)
		.run(now);
	connection
		.prepare(
			`DELETE FROM platform_file_contents WHERE NOT EXISTS (
				SELECT 1 FROM platform_file_references r WHERE r.content = platform_file_contents.hash)`,
		)
		.run();
}

// The file contents a database needs at an instant (ADR 0028, spec of phase 1d3, «Copia»): those of its live
// references and of its released ones whose entry is still undoable then, not undone and not yet expired. A
// prepared file is not among them. The backup reads it from its snapshot at the capture instant; restoring needs
// the same of the copy it restores.

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

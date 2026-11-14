// The tables of probe, the test module of phase 1 (ADR 0021, ADR 0023, ADR 0029): notes and comments, owned and
// with a foreign key between them, in its own area, and one owned table in each of its other areas; the household's
// labels, an area table in its own area; and scraps, a table the platform does not know.
import { id, integer, moduleTables, text } from "@domus/module-sdk/db";

import { areas } from "./areas";

const { areaTable, ownedTable, table } = moduleTables("probe", areas);

/** probe_notes */
export const notes = ownedTable(
	"notes",
	{ type: "note", area: "probe" },
	{ body: text().notNull() },
);

/** probe_comments: each one belongs to a note of probe, and has its own owner. */
export const comments = ownedTable(
	"comments",
	{ type: "comment", area: "probe" },
	{
		noteId: integer("note_id")
			.notNull()
			.references(() => notes.id),
		body: text().notNull(),
	},
);

/** probe_board: public by default, editable by anyone with write. */
export const board = ownedTable(
	"board",
	{ type: "board", area: "probe.board" },
	{ body: text().notNull() },
);

/** probe_health: always private. */
export const health = ownedTable(
	"health",
	{ type: "health", area: "probe.health" },
	{ body: text().notNull() },
);

/** probe_secret: always private. */
export const secret = ownedTable(
	"secret",
	{ type: "secret", area: "probe.secret" },
	{ body: text().notNull() },
);

/** probe_labels: the household's, without an owner, seen whole by whoever reads probe. */
export const labels = areaTable(
	"labels",
	{ type: "label", area: "probe" },
	{ name: text().notNull() },
);

/**
 * probe_scraps: a table without an owner that does not declare itself an area table, so its changes invalidate
 * nothing and no notice is about them. No action writes it: the tests do, from a handler they wrap.
 */
export const scraps = table("scraps", { id: id(), body: text().notNull() });

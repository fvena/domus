// The tables of probe, the test module of phase 1 (ADR 0021, ADR 0023). Every table has an owner: notes and
// comments, with a foreign key between them, in its own area, and one table in each of its other areas.
import { integer, moduleTables, text } from "@domus/module-sdk/db";

import { areas } from "./areas";

const { ownedTable } = moduleTables("probe", areas);

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

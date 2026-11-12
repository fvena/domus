// The tables of probe, the test module of phase 1 (ADR 0021). Two tables with a foreign key between them,
// so the checks over real modules meet a real one.
import { id, integer, moduleTables, text } from "@domus/module-sdk/db";

const { table } = moduleTables("probe");

/** probe_notes */
export const notes = table("notes", { id: id(), body: text().notNull() });

/** probe_comments: each one belongs to a note of probe. */
export const comments = table("comments", {
	id: id(),
	noteId: integer("note_id")
		.notNull()
		.references(() => notes.id),
	body: text().notNull(),
});

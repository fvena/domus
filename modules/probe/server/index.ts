// probe, the test module of phase 1 (ADR 0021, ADR 0022). testOnly keeps it out of the module list of
// apps/api: tests import it and hand it to test-utils. It stores notes and comments and offers actions on them.
import { defineModule, type ModuleDatabase } from "@domus/module-sdk";
import { eq } from "@domus/module-sdk/db";

import { probeContract } from "../contracts";
import { migrations } from "./migrations";
import * as schema from "./schema";

/** The note with this id, if there is one. */
function findNote(db: ModuleDatabase<typeof schema>, id: number) {
	return db.select().from(schema.notes).where(eq(schema.notes.id, id)).get();
}

export default defineModule({
	id: "probe",
	testOnly: true,
	schema,
	migrations,
	contract: probeContract,
	actions: {
		listNotes: ({ db }) => db.select().from(schema.notes).orderBy(schema.notes.id).all(),
		getNote: ({ db, input }) => findNote(db, input.id) ?? null,

		addNote: ({ db, input }) => {
			const added = db.insert(schema.notes).values({ body: input.body }).returning().get();
			return {
				result: added,
				touched: [{ type: "note", id: added.id }],
				inverse: { action: "probe.deleteNote", input: { id: added.id } },
			};
		},
		editNote: ({ db, input, errors }) => {
			const before = findNote(db, input.id);
			if (!before) throw errors.NOTE_NOT_FOUND();
			db.update(schema.notes)
				.set({ body: input.body })
				.where(eq(schema.notes.id, input.id))
				.run();
			const edited = { ...before, body: input.body };
			return {
				result: edited,
				touched: [{ type: "note", id: edited.id }],
				inverse: { action: "probe.editNote", input: before },
			};
		},
		deleteNote: ({ db, input, errors }) => {
			const found = findNote(db, input.id);
			if (!found) throw errors.NOTE_NOT_FOUND();
			const comment = db
				.select({ id: schema.comments.id })
				.from(schema.comments)
				.where(eq(schema.comments.noteId, input.id))
				.get();
			if (comment) throw errors.NOTE_HAS_COMMENTS();
			db.delete(schema.notes).where(eq(schema.notes.id, input.id)).run();
			return {
				result: found,
				touched: [{ type: "note", id: found.id }],
				inverse: { action: "probe.restoreNote", input: found },
			};
		},
		restoreNote: ({ db, input }) => {
			const restored = db.insert(schema.notes).values(input).returning().get();
			return {
				result: restored,
				touched: [{ type: "note", id: restored.id }],
				inverse: { action: "probe.deleteNote", input: { id: restored.id } },
			};
		},
		addComment: ({ db, input, errors }) => {
			if (!findNote(db, input.noteId)) throw errors.NOTE_NOT_FOUND();
			const added = db.insert(schema.comments).values(input).returning().get();
			return {
				result: added,
				touched: [{ type: "comment", id: added.id }],
				inverse: { action: "probe.deleteComment", input: { id: added.id } },
			};
		},
		deleteComment: ({ db, input, errors }) => {
			const deleted = db
				.delete(schema.comments)
				.where(eq(schema.comments.id, input.id))
				.returning()
				.get();
			if (!deleted) throw errors.COMMENT_NOT_FOUND();
			return { result: deleted, touched: [{ type: "comment", id: deleted.id }] };
		},
	},
});

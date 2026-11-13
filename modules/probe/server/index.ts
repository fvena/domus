// probe, the test module of phase 1 (ADR 0021, ADR 0022, ADR 0023). testOnly keeps it out of the module list of
// apps/api: tests import it and hand it to test-utils. It stores owned notes and comments and offers actions on
// them, and one owned table in each of its other areas. Every query on an owned table carries its visibility
// predicate, so a record the account does not see answers as one that does not exist.
import { type ActionContext, defineModule, type ModuleDatabase } from "@domus/module-sdk";
import { and, asc, count, eq, sql } from "@domus/module-sdk/db";

import { probeContract } from "../contracts";
import { areas } from "./areas";
import { migrations } from "./migrations";
import * as schema from "./schema";

type Context = Pick<ActionContext<unknown, typeof schema>, "db" | "visible">;
type Files = ActionContext<unknown, typeof schema>["files"];

const note = { id: schema.notes.id, body: schema.notes.body };
const boardNote = { id: schema.board.id, body: schema.board.body };
const comment = {
	id: schema.comments.id,
	noteId: schema.comments.noteId,
	body: schema.comments.body,
};

/** The note with this id, if the account sees one. */
function findNote({ db, visible }: Context, id: number) {
	return db
		.select({ ...note, visibility: schema.notes.visibility })
		.from(schema.notes)
		.where(and(eq(schema.notes.id, id), visible(schema.notes)))
		.get();
}

/** A note as the reads answer it, with its files. */
function withFiles(files: Files, found: { readonly id: number; readonly body: string }) {
	return { id: found.id, body: found.body, files: [...files.of(schema.notes, found.id)] };
}

/** The note with the input's id and its files, if the account sees one: what `getNote` and `getGuardedNote` answer. */
function noteById(
	context: Context & { readonly input: { readonly id: number }; readonly files: Files },
) {
	const found = findNote(context, context.input.id);
	return found ? withFiles(context.files, found) : null;
}

/** The records the account sees of a table with only a body, oldest first. */
function entriesOf(
	db: ModuleDatabase<typeof schema>,
	visible: Context["visible"],
	table: typeof schema.board | typeof schema.health | typeof schema.secret,
) {
	return db
		.select({ id: table.id, body: table.body })
		.from(table)
		.where(visible(table))
		.orderBy(table.id)
		.all();
}

export default defineModule({
	id: "probe",
	testOnly: true,
	areas,
	schema,
	migrations,
	contract: probeContract,
	actions: {
		listNotes: ({ db, visible, files }) =>
			db
				.select(note)
				.from(schema.notes)
				.where(visible(schema.notes))
				.orderBy(schema.notes.id)
				.all()
				.map((found) => withFiles(files, found)),
		getNote: noteById,
		getGuardedNote: noteById,
		countNotes: ({ db, visible }) =>
			db.select({ total: count() }).from(schema.notes).where(visible(schema.notes)).get()
				?.total ?? 0,
		searchNotes: ({ db, visible, input, files }) =>
			db
				.select(note)
				.from(schema.notes)
				.where(
					and(sql`instr(${schema.notes.body}, ${input.text}) > 0`, visible(schema.notes)),
				)
				.orderBy(schema.notes.id)
				.all()
				.map((found) => withFiles(files, found)),
		notesWithComments: ({ db, visible }) =>
			db
				.select({ note, comment })
				.from(schema.notes)
				.innerJoin(schema.comments, eq(schema.comments.noteId, schema.notes.id))
				.where(and(visible(schema.notes), visible(schema.comments)))
				.orderBy(asc(schema.notes.id), asc(schema.comments.id))
				.all(),

		addNote: ({ db, input, ownership }) => {
			const added = db
				.insert(schema.notes)
				.values({ ...ownership(schema.notes), body: input.body })
				.returning(note)
				.get();
			return {
				result: added,
				touched: [{ type: "note", id: added.id }],
				inverse: { action: "probe.deleteNote", input: { id: added.id } },
			};
		},
		editNote: (context) => {
			const { db, input, errors, visible } = context;
			const before = findNote(context, input.id);
			if (!before) throw errors.NOTE_NOT_FOUND();
			db.update(schema.notes)
				.set({ body: input.body })
				.where(and(eq(schema.notes.id, input.id), visible(schema.notes)))
				.run();
			return {
				result: { id: before.id, body: input.body },
				touched: [{ type: "note", id: before.id }],
				inverse: { action: "probe.editNote", input: { id: before.id, body: before.body } },
			};
		},
		deleteNote: (context) => {
			const { db, input, errors, editable, forbidden, files } = context;
			const found = findNote(context, input.id);
			if (!found) throw errors.NOTE_NOT_FOUND();
			const mayDelete = db
				.select({ id: schema.notes.id })
				.from(schema.notes)
				.where(and(eq(schema.notes.id, input.id), editable(schema.notes)))
				.get();
			if (!mayDelete) throw forbidden();
			// The referential block (ADR 0024): any comment blocks it, seen or not, since deleting would break the
			// foreign key. Asked only once the account sees the note and may delete it, and the answer reveals
			// nothing else of them.
			const blocked = db
				.select({ id: schema.comments.id })
				.from(schema.comments)
				.where(eq(schema.comments.noteId, input.id))
				.get();
			if (blocked) throw errors.NOTE_HAS_COMMENTS();
			// Its files go with it, released for its undo to reattach them (ADR 0028).
			const released = files
				.of(schema.notes, found.id)
				.map((file) => files.detach(file.id, { table: schema.notes, id: found.id }).id);
			db.delete(schema.notes)
				.where(and(eq(schema.notes.id, input.id), editable(schema.notes)))
				.run();
			return {
				result: { id: found.id, body: found.body },
				touched: [{ type: "note", id: found.id }],
				inverse: { action: "probe.restoreNote", input: { ...found, files: released } },
			};
		},
		restoreNote: ({ db, input, ownership, files }) => {
			const { files: released = [], ...values } = input;
			const restored = db
				.insert(schema.notes)
				.values({ ...ownership(schema.notes), ...values })
				.returning(note)
				.get();
			for (const file of released)
				files.reattach(file, { table: schema.notes, id: restored.id });
			return {
				result: restored,
				touched: [{ type: "note", id: restored.id }],
				inverse: { action: "probe.deleteNote", input: { id: restored.id } },
			};
		},
		attachFile: (context) => {
			const { input, files } = context;
			const attached = files.attach(input.prepared, {
				table: schema.notes,
				id: input.noteId,
			});
			return {
				result: attached,
				touched: [],
				inverse: {
					action: "probe.detachFile",
					input: { noteId: input.noteId, file: attached.id },
				},
			};
		},
		detachFile: ({ input, files }) => {
			const detached = files.detach(input.file, { table: schema.notes, id: input.noteId });
			return {
				result: detached,
				touched: [],
				inverse: { action: "probe.restoreFile", input },
			};
		},
		restoreFile: ({ input, files }) => {
			const restored = files.reattach(input.file, { table: schema.notes, id: input.noteId });
			return {
				result: restored,
				touched: [],
				inverse: { action: "probe.detachFile", input },
			};
		},
		setNoteVisibility: (context) => {
			const { db, input, errors, visible } = context;
			const before = findNote(context, input.id);
			if (!before) throw errors.NOTE_NOT_FOUND();
			db.update(schema.notes)
				.set({ visibility: input.visibility })
				.where(and(eq(schema.notes.id, input.id), visible(schema.notes)))
				.run();
			return {
				result: { id: before.id, visibility: input.visibility },
				touched: [{ type: "note", id: before.id }],
				inverse: {
					action: "probe.setNoteVisibility",
					input: { id: before.id, visibility: before.visibility },
				},
			};
		},
		addComment: (context) => {
			const { db, input, errors, ownership } = context;
			if (!findNote(context, input.noteId)) throw errors.NOTE_NOT_FOUND();
			const added = db
				.insert(schema.comments)
				.values({ ...ownership(schema.comments), ...input })
				.returning(comment)
				.get();
			return {
				result: added,
				touched: [{ type: "comment", id: added.id }],
				inverse: { action: "probe.deleteComment", input: { id: added.id } },
			};
		},
		deleteComment: ({ db, input, errors, visible }) => {
			const deleted = db
				.delete(schema.comments)
				.where(and(eq(schema.comments.id, input.id), visible(schema.comments)))
				.returning(comment)
				.get();
			if (!deleted) throw errors.COMMENT_NOT_FOUND();
			return { result: deleted, touched: [{ type: "comment", id: deleted.id }] };
		},

		configure: ({ db, input, actor, errors, visible }) => {
			const mine = db
				.update(schema.notes)
				.set({ visibility: input.visibility })
				.where(and(eq(schema.notes.owner, actor.account), visible(schema.notes)))
				.returning({ id: schema.notes.id })
				.all();
			if (mine.length === 0) throw errors.NO_NOTES();
			return {
				result: { notes: mine.length },
				touched: mine.map(({ id }) => ({ type: "note", id })),
			};
		},

		listBoard: ({ db, visible }) => entriesOf(db, visible, schema.board),
		addBoardNote: ({ db, input, ownership }) => {
			const added = db
				.insert(schema.board)
				.values({ ...ownership(schema.board), body: input.body })
				.returning(boardNote)
				.get();
			return {
				result: added,
				touched: [{ type: "board", id: added.id }],
				inverse: { action: "probe.deleteBoardNote", input: { id: added.id } },
			};
		},
		editBoardNote: ({ db, input, errors, visible }) => {
			const before = db
				.select(boardNote)
				.from(schema.board)
				.where(and(eq(schema.board.id, input.id), visible(schema.board)))
				.get();
			if (!before) throw errors.BOARD_NOTE_NOT_FOUND();
			db.update(schema.board)
				.set({ body: input.body })
				.where(and(eq(schema.board.id, input.id), visible(schema.board)))
				.run();
			return {
				result: { id: before.id, body: input.body },
				touched: [{ type: "board", id: before.id }],
				inverse: { action: "probe.editBoardNote", input: before },
			};
		},
		deleteBoardNote: ({ db, input, errors, visible }) => {
			const deleted = db
				.delete(schema.board)
				.where(and(eq(schema.board.id, input.id), visible(schema.board)))
				.returning(boardNote)
				.get();
			if (!deleted) throw errors.BOARD_NOTE_NOT_FOUND();
			return { result: deleted, touched: [{ type: "board", id: deleted.id }] };
		},

		readHealth: ({ db, visible }) => entriesOf(db, visible, schema.health),
		recordHealth: ({ db, input, ownership }) => {
			const added = db
				.insert(schema.health)
				.values({ ...ownership(schema.health), body: input.body })
				.returning({ id: schema.health.id, body: schema.health.body })
				.get();
			return { result: added, touched: [{ type: "health", id: added.id }] };
		},
		readSecret: ({ db, visible }) => entriesOf(db, visible, schema.secret),
		recordSecret: ({ db, input, ownership }) => {
			const added = db
				.insert(schema.secret)
				.values({ ...ownership(schema.secret), body: input.body })
				.returning({ id: schema.secret.id, body: schema.secret.body })
				.get();
			return { result: added, touched: [{ type: "secret", id: added.id }] };
		},
	},
});

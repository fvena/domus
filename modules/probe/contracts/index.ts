// The contract of probe, the test module of phase 1 (ADR 0022, ADR 0023): the actions it offers, with their
// input and output. Pure, like every contract. Every read sees only what the account sees.
import { readAction, writeAction } from "@domus/module-sdk/contracts";
import { z } from "zod";

/** The id of a note or of a comment: SQLite gives positive integers. */
const recordId = z.number().int().positive();
const note = z.object({ id: z.number().int(), body: z.string() });
const comment = z.object({ id: z.number().int(), noteId: z.number().int(), body: z.string() });
/** A record of the always private areas: health and secret. */
const entry = z.object({ id: z.number().int(), body: z.string() });

const visibility = z.enum(["private", "public"]);

const NOTE_NOT_FOUND = { message: "There is no note with this id." };
const BOARD_NOTE_NOT_FOUND = { message: "There is no board note with this id." };

export const probeContract = {
	/** Every note, oldest first. */
	listNotes: readAction({ level: "read" }).output(z.array(note)),
	/** One note by its id, or `null` when there is none. */
	getNote: readAction({ level: "read" })
		.input(z.object({ id: recordId }))
		.output(note.nullable()),
	/** How many notes there are. */
	countNotes: readAction({ level: "read" }).output(z.number().int()),
	/** The notes whose text holds `text`, oldest first. */
	searchNotes: readAction({ level: "read" })
		.input(z.object({ text: z.string().min(1) }))
		.output(z.array(note)),
	/** Each comment with its note, by note and then comment. */
	notesWithComments: readAction({ level: "read" }).output(z.array(z.object({ note, comment }))),

	/** Adds a note. Undone by deleting it. */
	addNote: writeAction({ undoable: true, level: "write" })
		.input(z.object({ body: z.string().min(1) }))
		.output(note),
	/** Changes the text of a note. Undone by editing it back to the previous text. */
	editNote: writeAction({ undoable: true, level: "write" })
		.input(z.object({ id: recordId, body: z.string().min(1) }))
		.output(note)
		.errors({ NOTE_NOT_FOUND }),
	/** Deletes a note without comments and returns it. Undone by restoring it. */
	deleteNote: writeAction({ undoable: true, level: "write" })
		.input(z.object({ id: recordId }))
		.output(note)
		.errors({
			NOTE_NOT_FOUND,
			NOTE_HAS_COMMENTS: { message: "A note with comments cannot be deleted." },
		}),
	/** Brings back a deleted note with its id, text and visibility. Undone by deleting it again. */
	restoreNote: writeAction({ undoable: true, level: "write" })
		.input(
			z.object({
				id: recordId,
				body: z.string().min(1),
				visibility,
			}),
		)
		.output(note),
	/** Makes a note private or public: only its owner can. Undone by setting the previous visibility back. */
	setNoteVisibility: writeAction({ undoable: true, level: "write" })
		.input(z.object({ id: recordId, visibility }))
		.output(z.object({ id: z.number().int(), visibility }))
		.errors({ NOTE_NOT_FOUND }),
	/** Adds a comment to a note. It touches only the comment. Undone by deleting it. */
	addComment: writeAction({ undoable: true, level: "write" })
		.input(z.object({ noteId: recordId, body: z.string().min(1) }))
		.output(comment)
		.errors({ NOTE_NOT_FOUND }),
	/** Deletes a comment and returns it. It cannot be undone, so it always asks for confirmation first. */
	deleteComment: writeAction({ undoable: false, level: "write", alwaysConfirm: true })
		.input(z.object({ id: recordId }))
		.output(comment)
		.errors({ COMMENT_NOT_FOUND: { message: "There is no comment with this id." } }),

	/** Every board note one sees, oldest first: public by default, so everyone's. */
	listBoard: readAction({ area: "probe.board", level: "read" }).output(z.array(entry)),
	/** Pins a note on the board, public by default. Undone by deleting it. */
	addBoardNote: writeAction({ undoable: true, area: "probe.board", level: "write" })
		.input(z.object({ body: z.string().min(1) }))
		.output(entry),
	/** Changes the text of a board note: anyone with write, as the area allows it. Undone by editing it back. */
	editBoardNote: writeAction({ undoable: true, area: "probe.board", level: "write" })
		.input(z.object({ id: recordId, body: z.string().min(1) }))
		.output(entry)
		.errors({ BOARD_NOTE_NOT_FOUND }),
	/** Deletes a board note and returns it: anyone with write. It cannot be undone. */
	deleteBoardNote: writeAction({ undoable: false, area: "probe.board", level: "write" })
		.input(z.object({ id: recordId }))
		.output(entry)
		.errors({ BOARD_NOTE_NOT_FOUND }),

	/** Every health record: only one's own, as the area is always private. */
	readHealth: readAction({ area: "probe.health", level: "read" }).output(z.array(entry)),
	/** Records a health entry. It cannot be undone. */
	recordHealth: writeAction({ undoable: false, area: "probe.health", level: "write" })
		.input(z.object({ body: z.string().min(1) }))
		.output(entry),
	/** Every secret: only one's own, as the area is always private. */
	readSecret: readAction({ area: "probe.secret", level: "read" }).output(z.array(entry)),
	/** Records a secret. It cannot be undone. */
	recordSecret: writeAction({ undoable: false, area: "probe.secret", level: "write" })
		.input(z.object({ body: z.string().min(1) }))
		.output(entry),
};

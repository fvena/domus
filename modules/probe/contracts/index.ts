// The contract of probe, the test module of phase 1 (ADR 0022): the actions it offers, with their input and
// output. Pure, like every contract.
import { readAction, writeAction } from "@domus/module-sdk/contracts";
import { z } from "zod";

/** The id of a note or of a comment: SQLite gives positive integers. */
const recordId = z.number().int().positive();
const note = z.object({ id: z.number().int(), body: z.string() });
const comment = z.object({ id: z.number().int(), noteId: z.number().int(), body: z.string() });

const NOTE_NOT_FOUND = { message: "There is no note with this id." };

export const probeContract = {
	/** Every note, oldest first. */
	listNotes: readAction().output(z.array(note)),
	/** One note by its id, or `null` when there is none. */
	getNote: readAction()
		.input(z.object({ id: recordId }))
		.output(note.nullable()),

	/** Adds a note. Undone by deleting it. */
	addNote: writeAction({ undoable: true })
		.input(z.object({ body: z.string().min(1) }))
		.output(note),
	/** Changes the text of a note. Undone by editing it back to the previous text. */
	editNote: writeAction({ undoable: true })
		.input(z.object({ id: recordId, body: z.string().min(1) }))
		.output(note)
		.errors({ NOTE_NOT_FOUND }),
	/** Deletes a note without comments and returns it. Undone by restoring it. */
	deleteNote: writeAction({ undoable: true })
		.input(z.object({ id: recordId }))
		.output(note)
		.errors({
			NOTE_NOT_FOUND,
			NOTE_HAS_COMMENTS: { message: "A note with comments cannot be deleted." },
		}),
	/** Brings back a deleted note with its id and text. Undone by deleting it again. */
	restoreNote: writeAction({ undoable: true })
		.input(z.object({ id: recordId, body: z.string().min(1) }))
		.output(note),
	/** Adds a comment to a note. It touches only the comment. Undone by deleting it. */
	addComment: writeAction({ undoable: true })
		.input(z.object({ noteId: recordId, body: z.string().min(1) }))
		.output(comment)
		.errors({ NOTE_NOT_FOUND }),
	/** Deletes a comment and returns it. It cannot be undone. */
	deleteComment: writeAction({ undoable: false })
		.input(z.object({ id: recordId }))
		.output(comment)
		.errors({ COMMENT_NOT_FOUND: { message: "There is no comment with this id." } }),
};

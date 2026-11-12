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

const NOTE_NOT_FOUND = { message: "There is no note with this id." };

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
				visibility: z.enum(["private", "public"]),
			}),
		)
		.output(note),
	/** Adds a comment to a note. It touches only the comment. Undone by deleting it. */
	addComment: writeAction({ undoable: true, level: "write" })
		.input(z.object({ noteId: recordId, body: z.string().min(1) }))
		.output(comment)
		.errors({ NOTE_NOT_FOUND }),
	/** Deletes a comment and returns it. It cannot be undone. */
	deleteComment: writeAction({ undoable: false, level: "write" })
		.input(z.object({ id: recordId }))
		.output(comment)
		.errors({ COMMENT_NOT_FOUND: { message: "There is no comment with this id." } }),

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

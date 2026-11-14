// The contract of probe, the test module of phase 1 (ADR 0022, ADR 0023): the actions it offers, with their
// input and output. Pure, like every contract. Every read sees only what the account sees.
import { fileRef, readAction, writeAction } from "@domus/module-sdk/contracts";
import { z } from "zod";

/** The id of a note or of a comment: SQLite gives positive integers. */
const recordId = z.number().int().positive();
const note = z.object({ id: z.number().int(), body: z.string() });
/** A note as the reads answer it: with its files, which a download takes from there. */
const noteWithFiles = note.extend({ files: z.array(fileRef()) });
const comment = z.object({ id: z.number().int(), noteId: z.number().int(), body: z.string() });
/** A record of the always private areas: health and secret. */
const entry = z.object({ id: z.number().int(), body: z.string() });

const visibility = z.enum(["private", "public"]);

const NOTE_NOT_FOUND = { message: "There is no note with this id." };
const BOARD_NOTE_NOT_FOUND = { message: "There is no board note with this id." };

export const probeContract = {
	/** Every note, oldest first. */
	listNotes: readAction({ level: "read" }).output(z.array(noteWithFiles)),
	/** One note by its id, or `null` when there is none. */
	getNote: readAction({ level: "read" })
		.input(z.object({ id: recordId }))
		.output(noteWithFiles.nullable()),
	/**
	 * One note as `getNote` answers it, after the person confirms every time: a download through it waits as a
	 * pending confirmation (ADR 0028).
	 */
	getGuardedNote: readAction({ level: "read", alwaysConfirm: true })
		.input(z.object({ id: recordId }))
		.output(noteWithFiles.nullable()),
	/** How many notes there are. */
	countNotes: readAction({ level: "read" }).output(z.number().int()),
	/** The notes whose text holds `text`, oldest first. */
	searchNotes: readAction({ level: "read" })
		.input(z.object({ text: z.string().min(1) }))
		.output(z.array(noteWithFiles)),
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
	/** Deletes a note without comments, releasing its files, and returns it. Undone by restoring it. */
	deleteNote: writeAction({ undoable: true, level: "write" })
		.input(z.object({ id: recordId }))
		.output(note)
		.errors({
			NOTE_NOT_FOUND,
			NOTE_HAS_COMMENTS: { message: "A note with comments cannot be deleted." },
		}),
	/**
	 * Brings back a deleted note with its id, text and visibility, and the files its deletion released: those only
	 * as the undo of that deletion. Undone by deleting it again.
	 */
	restoreNote: writeAction({ undoable: true, level: "write" })
		.input(
			z.object({
				id: recordId,
				body: z.string().min(1),
				visibility,
				// Optional: an inverse stored before notes had files is validated against this contract too.
				files: z.array(z.string().min(1)).optional(),
			}),
		)
		.output(note),
	/** Attaches a prepared file of this session to a note. Undone by detaching it. */
	attachFile: writeAction({ undoable: true, level: "write" })
		.input(z.object({ noteId: recordId, prepared: z.string().min(1) }))
		.output(fileRef()),
	/** Takes a file off a note. Undone by attaching it again with `reattachFile`. */
	detachFile: writeAction({ undoable: true, level: "write" })
		.input(z.object({ noteId: recordId, file: z.string().min(1) }))
		.output(fileRef()),
	/** Attaches again the file a detachment released: only as its undo. Undone by detaching it. */
	reattachFile: writeAction({ undoable: true, level: "write" })
		.input(z.object({ noteId: recordId, file: z.string().min(1) }))
		.output(fileRef()),
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

	/**
	 * Makes every note of one's own private or public at once: a setting of level manage, so it asks for a
	 * step-up proof of this exact input. It cannot be undone. Without notes of one's own there is nothing to do.
	 */
	configure: writeAction({ undoable: false, level: "manage" })
		.input(z.object({ visibility }))
		.output(z.object({ notes: z.number().int() }))
		.errors({ NO_NOTES: { message: "There are no notes of one's own to configure." } }),

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

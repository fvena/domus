// Visibility on reads (ADR 0023): each owned record is seen by its owner, or by anyone once public. A record
// the predicate hides does not exist, on every query form probe offers: one record, a list, a count, a search
// and a join of notes with comments, each table with its own predicate.
import { eq } from "@domus/module-sdk/db";
import { createTestPlatform, pendingFrom } from "@domus/test-utils";
import { describe, expect, it } from "vitest";

import probe from "../server";
import { comments, health, notes, secret } from "../server/schema";

const notFound = expect.objectContaining({ code: "NOTE_NOT_FOUND" });

/**
 * A platform with probe and two members. Ana's private note 1 and public note 2, and Bea's private note 3 and
 * public note 4, each with a comment of its own owner's visibility.
 */
function household() {
	const test = createTestPlatform({ modules: [probe] });
	const ana = test.member("ana");
	const bea = test.member("bea");
	const db = test.dbFor(probe);
	db.insert(notes)
		.values([
			{ owner: "ana", visibility: "private", body: "regalo para Bea" },
			{ owner: "ana", visibility: "public", body: "comprar pan" },
			{ owner: "bea", visibility: "private", body: "regalo para Ana" },
			{ owner: "bea", visibility: "public", body: "comprar leche" },
		])
		.run();
	db.insert(comments)
		.values([
			{ owner: "ana", visibility: "private", noteId: 1, body: "una bufanda" },
			{ owner: "ana", visibility: "public", noteId: 2, body: "integral" },
			{ owner: "bea", visibility: "private", noteId: 3, body: "un libro" },
			{ owner: "bea", visibility: "public", noteId: 4, body: "sin lactosa" },
		])
		.run();
	return { test, ana, bea };
}

describe("probe visibility on reads", () => {
	it("lists one's own notes and the public ones, never another's private", async () => {
		const { test, ana } = household();
		await using _ = test;

		expect(test.invoke(ana, "probe.listNotes")).toEqual([
			{ id: 1, body: "regalo para Bea" },
			{ id: 2, body: "comprar pan" },
			{ id: 4, body: "comprar leche" },
		]);
	});

	it("gets another's public note, and nothing of another's private one", async () => {
		const { test, ana } = household();
		await using _ = test;

		expect(test.invoke(ana, "probe.getNote", { id: 4 })).toEqual({
			id: 4,
			body: "comprar leche",
		});
		expect(test.invoke(ana, "probe.getNote", { id: 3 })).toBeNull();
	});

	it("counts only the notes one sees", async () => {
		const { test, ana, bea } = household();
		await using _ = test;

		expect(test.invoke(ana, "probe.countNotes")).toBe(3);
		expect(test.invoke(bea, "probe.countNotes")).toBe(3);
		expect(test.invoke(test.member("carmen"), "probe.countNotes")).toBe(2);
	});

	it("searches only the notes one sees", async () => {
		const { test, ana } = household();
		await using _ = test;

		expect(test.invoke(ana, "probe.searchNotes", { text: "regalo" })).toEqual([
			{ id: 1, body: "regalo para Bea" },
		]);
		expect(test.invoke(ana, "probe.searchNotes", { text: "comprar" })).toEqual([
			{ id: 2, body: "comprar pan" },
			{ id: 4, body: "comprar leche" },
		]);
	});

	it("joins notes with comments, hiding a private comment on a public note", async () => {
		const { test, ana } = household();
		await using _ = test;
		// Bea's private comment on Ana's public note: the note shows, the comment does not.
		test.dbFor(probe)
			.insert(comments)
			.values({ owner: "bea", visibility: "private", noteId: 2, body: "ya lo compro yo" })
			.run();

		expect(test.invoke(ana, "probe.notesWithComments")).toEqual([
			{
				note: { id: 1, body: "regalo para Bea" },
				comment: { id: 1, noteId: 1, body: "una bufanda" },
			},
			{
				note: { id: 2, body: "comprar pan" },
				comment: { id: 2, noteId: 2, body: "integral" },
			},
			{
				note: { id: 4, body: "comprar leche" },
				comment: { id: 4, noteId: 4, body: "sin lactosa" },
			},
		]);
	});

	it("answers not found when editing, deleting or commenting another's private note", async () => {
		const { test, ana } = household();
		await using _ = test;

		expect(() =>
			test.invoke(ana, "probe.editNote", { id: 3, body: "otro" }, { idempotencyKey: "k1" }),
		).toThrow(notFound);
		expect(() =>
			test.invoke(ana, "probe.deleteNote", { id: 3 }, { idempotencyKey: "k2" }),
		).toThrow(notFound);
		expect(() =>
			test.invoke(
				ana,
				"probe.addComment",
				{ noteId: 3, body: "otro" },
				{ idempotencyKey: "k3" },
			),
		).toThrow(notFound);
		expect(test.log()).toEqual([]);
	});

	it("answers not found when deleting another's private comment", async () => {
		const { test, ana } = household();
		await using _ = test;

		const pending = pendingFrom(() =>
			test.invoke(ana, "probe.deleteComment", { id: 3 }, { idempotencyKey: "k1" }),
		);
		expect(() => test.confirm(ana, pending)).toThrow(
			expect.objectContaining({ code: "COMMENT_NOT_FOUND" }),
		);
	});
});

describe("probe ownership on create", () => {
	it("makes the represented account the owner, with its area's default visibility", async () => {
		await using test = createTestPlatform({ modules: [probe] });
		const ana = test.member("ana", { via: "kira" });
		const bea = test.member("bea");

		test.invoke(ana, "probe.addNote", { body: "comprar pan" }, { idempotencyKey: "k1" });
		test.invoke(
			ana,
			"probe.addComment",
			{ noteId: 1, body: "integral" },
			{ idempotencyKey: "k2" },
		);
		test.invoke(ana, "probe.recordHealth", { body: "alergia" }, { idempotencyKey: "k3" });

		// The default of `probe` and `probe.health` is private: only Ana sees what she created.
		expect(test.invoke(ana, "probe.notesWithComments")).toHaveLength(1);
		expect(test.invoke(bea, "probe.listNotes")).toEqual([]);
		expect(test.invoke(ana, "probe.readHealth")).toEqual([{ id: 1, body: "alergia" }]);
		expect(test.invoke(bea, "probe.readHealth")).toEqual([]);
		const db = test.dbFor(probe);
		expect(db.select().from(notes).all()).toEqual([
			{ id: 1, owner: "ana", visibility: "private", body: "comprar pan" },
		]);
		expect(db.select().from(comments).all()).toEqual([
			{ id: 1, owner: "ana", visibility: "private", noteId: 1, body: "integral" },
		]);
	});
});

describe("probe always private areas", () => {
	it.each([
		["probe.health", health],
		["probe.secret", secret],
	])("%s admits no public record, by its CHECK", async (_area, table) => {
		await using test = createTestPlatform({ modules: [probe] });
		const db = test.dbFor(probe);

		expect(() =>
			db.insert(table).values({ owner: "ana", visibility: "public", body: "x" }).run(),
		).toThrow(/CHECK constraint failed/);
		db.insert(table).values({ owner: "ana", visibility: "private", body: "x" }).run();
		expect(() =>
			db.update(table).set({ visibility: "public" }).where(eq(table.id, 1)).run(),
		).toThrow(/CHECK constraint failed/);
	});

	it("keeps each member's secret from the other", async () => {
		await using test = createTestPlatform({ modules: [probe] });
		const ana = test.member("ana");
		const bea = test.member("bea");

		test.invoke(
			ana,
			"probe.recordSecret",
			{ body: "clave del trastero" },
			{ idempotencyKey: "k1" },
		);

		expect(test.invoke(ana, "probe.readSecret")).toEqual([
			{ id: 1, body: "clave del trastero" },
		]);
		expect(test.invoke(bea, "probe.readSecret")).toEqual([]);
	});
});

// Writes on owned records, checked by the write capture (ADR 0023): another's public record is edited only where
// its area allows it, and only the owner changes a record's visibility.
describe("probe visibility on writes", () => {
	const forbidden = expect.objectContaining({ code: "FORBIDDEN" });

	it("keeps another's public note and comment from being edited or deleted in probe", async () => {
		const { test, ana } = household();
		await using _ = test;

		expect(() =>
			test.invoke(ana, "probe.editNote", { id: 4, body: "otro" }, { idempotencyKey: "k1" }),
		).toThrow(forbidden);
		const pending = pendingFrom(() =>
			test.invoke(ana, "probe.deleteComment", { id: 4 }, { idempotencyKey: "k2" }),
		);
		expect(() => test.confirm(ana, pending)).toThrow(forbidden);
		expect(test.invoke(ana, "probe.getNote", { id: 4 })).toEqual({
			id: 4,
			body: "comprar leche",
		});
		expect(test.log()).toEqual([]);
	});

	it("lets anyone with write edit and delete another's public board note in probe.board", async () => {
		await using test = createTestPlatform({ modules: [probe] });
		const ana = test.member("ana");
		const bea = test.member("bea");

		expect(
			test.invoke(ana, "probe.addBoardNote", { body: "turnos" }, { idempotencyKey: "k1" }),
		).toEqual(expect.objectContaining({ result: { id: 1, body: "turnos" } }));
		test.invoke(
			bea,
			"probe.editBoardNote",
			{ id: 1, body: "turnos de cocina" },
			{ idempotencyKey: "k2" },
		);
		expect(test.invoke(ana, "probe.listBoard")).toEqual([{ id: 1, body: "turnos de cocina" }]);

		test.invoke(bea, "probe.deleteBoardNote", { id: 1 }, { idempotencyKey: "k3" });
		expect(test.invoke(ana, "probe.listBoard")).toEqual([]);
	});

	it("lets only the owner change the visibility of a note", async () => {
		const { test, ana, bea } = household();
		await using _ = test;

		test.invoke(
			ana,
			"probe.setNoteVisibility",
			{ id: 1, visibility: "public" },
			{ idempotencyKey: "k1" },
		);
		expect(test.invoke(bea, "probe.getNote", { id: 1 })).toEqual({
			id: 1,
			body: "regalo para Bea",
		});

		expect(() =>
			test.invoke(
				bea,
				"probe.setNoteVisibility",
				{ id: 1, visibility: "private" },
				{ idempotencyKey: "k2" },
			),
		).toThrow(forbidden);
		expect(test.invoke(bea, "probe.getNote", { id: 1 })).not.toBeNull();
	});
});

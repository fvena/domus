import { createTestPlatform } from "@domus/test-utils";
import { describe, expect, it } from "vitest";

import probe from "../server";

/** A platform with probe, and Ana writing through Kira. */
function probePlatform() {
	const test = createTestPlatform({ modules: [probe] });
	return { test, ana: test.member("ana", { via: "kira" }) };
}

const conflict = (reason: string) =>
	expect.objectContaining({ code: "CONFLICT", data: { reason } });
const irreversible = expect.objectContaining({
	code: "UNPROCESSABLE_CONTENT",
	data: { reason: "irreversible" },
});

describe("probe undo", () => {
	it("undoes adding a note: the note is gone", async () => {
		const { test, ana } = probePlatform();
		await using _ = test;
		const added = test.invoke(
			ana,
			"probe.addNote",
			{ body: "comprar pan" },
			{ idempotencyKey: "k1" },
		);

		expect(test.undo(ana, added.entry, { idempotencyKey: "u1" })).toEqual({
			result: { id: 1, body: "comprar pan" },
			entry: 2,
		});
		expect(test.invoke(ana, "probe.listNotes")).toEqual([]);
	});

	it("undoes editing a note: its previous text is back", async () => {
		const { test, ana } = probePlatform();
		await using _ = test;
		test.invoke(ana, "probe.addNote", { body: "comprar pan" }, { idempotencyKey: "k1" });
		const edited = test.invoke(
			ana,
			"probe.editNote",
			{ id: 1, body: "comprar leche" },
			{ idempotencyKey: "k2" },
		);

		test.undo(ana, edited.entry, { idempotencyKey: "u1" });

		expect(test.invoke(ana, "probe.listNotes")).toEqual([{ id: 1, body: "comprar pan" }]);
	});

	it("undoes deleting a note: it is back with its id and text", async () => {
		const { test, ana } = probePlatform();
		await using _ = test;
		test.invoke(ana, "probe.addNote", { body: "comprar pan" }, { idempotencyKey: "k1" });
		test.invoke(ana, "probe.addNote", { body: "regar" }, { idempotencyKey: "k2" });
		const deleted = test.invoke(ana, "probe.deleteNote", { id: 1 }, { idempotencyKey: "k3" });

		test.undo(ana, deleted.entry, { idempotencyKey: "u1" });

		expect(test.invoke(ana, "probe.listNotes")).toEqual([
			{ id: 1, body: "comprar pan" },
			{ id: 2, body: "regar" },
		]);
	});

	it("leaves one new entry, linked both ways with the one it undoes", async () => {
		const { test, ana } = probePlatform();
		await using _ = test;
		test.invoke(ana, "probe.addNote", { body: "comprar pan" }, { idempotencyKey: "k1" });

		test.undo(ana, 1, { idempotencyKey: "u1" });

		expect(test.log()).toEqual([
			expect.objectContaining({ entry: 1, action: "probe.addNote", undoneBy: 2 }),
			expect.objectContaining({
				entry: 2,
				action: "probe.deleteNote",
				actor: { account: "ana", via: "kira" },
				idempotencyKey: "u1",
				undoes: 1,
				undoneBy: null,
				input: { id: 1 },
				inverse: { action: "probe.restoreNote", input: { id: 1, body: "comprar pan" } },
				touched: [{ module: "probe", type: "note", id: "1" }],
			}),
		]);
	});

	it("never returns an inverse, from a write or from an undo", async () => {
		const { test, ana } = probePlatform();
		await using _ = test;

		const added = test.invoke(
			ana,
			"probe.addNote",
			{ body: "comprar pan" },
			{ idempotencyKey: "k1" },
		);
		const undone = test.undo(ana, added.entry, { idempotencyKey: "u1" });

		expect(Object.keys(added)).toEqual(["result", "entry"]);
		expect(Object.keys(undone)).toEqual(["result", "entry"]);
		expect(JSON.stringify([added, undone])).not.toContain("restoreNote");
	});

	it("answers changed-since when a later entry touched the same note, without change or entry", async () => {
		const { test, ana } = probePlatform();
		await using _ = test;
		test.invoke(ana, "probe.addNote", { body: "comprar pan" }, { idempotencyKey: "k1" });
		test.invoke(
			ana,
			"probe.editNote",
			{ id: 1, body: "comprar leche" },
			{ idempotencyKey: "k2" },
		);

		expect(() => test.undo(ana, 1, { idempotencyKey: "u1" })).toThrow(
			conflict("changed-since"),
		);
		expect(test.invoke(ana, "probe.listNotes")).toEqual([{ id: 1, body: "comprar leche" }]);
		expect(test.log()).toHaveLength(2);
	});

	it("answers changed-since even when that later change was undone", async () => {
		const { test, ana } = probePlatform();
		await using _ = test;
		test.invoke(ana, "probe.addNote", { body: "comprar pan" }, { idempotencyKey: "k1" });
		test.invoke(
			ana,
			"probe.editNote",
			{ id: 1, body: "comprar leche" },
			{ idempotencyKey: "k2" },
		);
		test.undo(ana, 2, { idempotencyKey: "u1" });

		expect(() => test.undo(ana, 1, { idempotencyKey: "u2" })).toThrow(
			conflict("changed-since"),
		);
		expect(test.invoke(ana, "probe.listNotes")).toEqual([{ id: 1, body: "comprar pan" }]);
	});

	it("lets another note change in between", async () => {
		const { test, ana } = probePlatform();
		await using _ = test;
		test.invoke(ana, "probe.addNote", { body: "comprar pan" }, { idempotencyKey: "k1" });
		test.invoke(ana, "probe.addNote", { body: "regar" }, { idempotencyKey: "k2" });
		test.invoke(
			ana,
			"probe.editNote",
			{ id: 2, body: "regar el olivo" },
			{ idempotencyKey: "k3" },
		);

		test.undo(ana, 1, { idempotencyKey: "u1" });

		expect(test.invoke(ana, "probe.listNotes")).toEqual([{ id: 2, body: "regar el olivo" }]);
	});

	it("lets the module's rule refuse undoing a note that now has comments, without change or entry", async () => {
		const { test, ana } = probePlatform();
		await using _ = test;
		test.invoke(ana, "probe.addNote", { body: "comprar pan" }, { idempotencyKey: "k1" });
		test.invoke(
			ana,
			"probe.addComment",
			{ noteId: 1, body: "integral" },
			{ idempotencyKey: "k2" },
		);

		expect(() => test.undo(ana, 1, { idempotencyKey: "u1" })).toThrow(
			expect.objectContaining({ code: "NOTE_HAS_COMMENTS" }),
		);
		expect(test.invoke(ana, "probe.listNotes")).toEqual([{ id: 1, body: "comprar pan" }]);
		expect(test.log()).toHaveLength(2);
		expect(test.log()[0]).toHaveProperty("undoneBy", null);
	});

	it("answers irreversible for a write that cannot be undone", async () => {
		const { test, ana } = probePlatform();
		await using _ = test;
		test.invoke(ana, "probe.addNote", { body: "comprar pan" }, { idempotencyKey: "k1" });
		test.invoke(
			ana,
			"probe.addComment",
			{ noteId: 1, body: "integral" },
			{ idempotencyKey: "k2" },
		);
		const deleted = test.invoke(
			ana,
			"probe.deleteComment",
			{ id: 1 },
			{ idempotencyKey: "k3" },
		);

		expect(() => test.undo(ana, deleted.entry, { idempotencyKey: "u1" })).toThrow(irreversible);
		expect(test.log()).toHaveLength(3);
	});

	it("answers not found for an entry that does not exist", async () => {
		const { test, ana } = probePlatform();
		await using _ = test;

		expect(() => test.undo(ana, 7, { idempotencyKey: "u1" })).toThrow(
			expect.objectContaining({ code: "NOT_FOUND" }),
		);
	});

	it("answers a repeated undo with an acknowledgement of its entry, and another key with already-undone", async () => {
		const { test, ana } = probePlatform();
		await using _ = test;
		test.invoke(ana, "probe.addNote", { body: "comprar pan" }, { idempotencyKey: "k1" });
		test.undo(ana, 1, { idempotencyKey: "u1" });

		expect(test.undo(ana, 1, { idempotencyKey: "u1" })).toStrictEqual({
			entry: 2,
			repeated: true,
		});
		expect(() => test.undo(ana, 1, { idempotencyKey: "u2" })).toThrow(
			conflict("already-undone"),
		);
		expect(test.log()).toHaveLength(2);
	});

	it("answers key-reused when an undo's key comes with another entry or with its inverse invoked directly", async () => {
		const { test, ana } = probePlatform();
		await using _ = test;
		test.invoke(ana, "probe.addNote", { body: "comprar pan" }, { idempotencyKey: "k1" });
		test.invoke(ana, "probe.addNote", { body: "regar" }, { idempotencyKey: "k2" });
		test.undo(ana, 1, { idempotencyKey: "u1" });

		expect(() => test.undo(ana, 2, { idempotencyKey: "u1" })).toThrow(conflict("key-reused"));
		expect(() =>
			test.invoke(ana, "probe.deleteNote", { id: 1 }, { idempotencyKey: "u1" }),
		).toThrow(conflict("key-reused"));
		expect(() => test.undo(ana, 2, { idempotencyKey: "k1" })).toThrow(conflict("key-reused"));
		expect(test.invoke(ana, "probe.listNotes")).toEqual([{ id: 2, body: "regar" }]);
	});

	it("redoes an edit by undoing its undo", async () => {
		const { test, ana } = probePlatform();
		await using _ = test;
		test.invoke(ana, "probe.addNote", { body: "comprar pan" }, { idempotencyKey: "k1" });
		const edited = test.invoke(
			ana,
			"probe.editNote",
			{ id: 1, body: "comprar leche" },
			{ idempotencyKey: "k2" },
		);
		const undone = test.undo(ana, edited.entry, { idempotencyKey: "u1" });

		test.undo(ana, undone.entry, { idempotencyKey: "u2" });

		expect(test.invoke(ana, "probe.listNotes")).toEqual([{ id: 1, body: "comprar leche" }]);
	});

	it("cannot redo adding a comment, whose inverse cannot be undone", async () => {
		const { test, ana } = probePlatform();
		await using _ = test;
		test.invoke(ana, "probe.addNote", { body: "comprar pan" }, { idempotencyKey: "k1" });
		const added = test.invoke(
			ana,
			"probe.addComment",
			{ noteId: 1, body: "integral" },
			{ idempotencyKey: "k2" },
		);
		const undone = test.undo(ana, added.entry, { idempotencyKey: "u1" });

		expect(() => test.undo(ana, undone.entry, { idempotencyKey: "u2" })).toThrow(irreversible);
	});

	it("does not undo when the account's permission no longer reaches the inverse's", async () => {
		const { test, ana } = probePlatform();
		await using __ = test;
		test.invoke(ana, "probe.addNote", { body: "comprar pan" }, { idempotencyKey: "k1" });

		test.prepare.grant("ana", "probe", "read");

		expect(() => test.undo(ana, 1, { idempotencyKey: "u1" })).toThrow(
			expect.objectContaining({ code: "FORBIDDEN" }),
		);
		expect(test.invoke(ana, "probe.listNotes")).toEqual([{ id: 1, body: "comprar pan" }]);
		expect(test.log()).toHaveLength(1);
	});

	it("delivers nothing on a repeated undo once the account's permission no longer reaches", async () => {
		const { test, ana } = probePlatform();
		await using _ = test;
		test.invoke(ana, "probe.addNote", { body: "comprar pan" }, { idempotencyKey: "k1" });
		test.undo(ana, 1, { idempotencyKey: "u1" });

		test.prepare.grant("ana", "probe", "none");

		expect(() => test.undo(ana, 1, { idempotencyKey: "u1" })).toThrow(
			expect.objectContaining({ code: "FORBIDDEN" }),
		);
	});
});

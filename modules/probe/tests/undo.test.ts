import { createTestPlatform } from "@domus/test-utils";
import { describe, expect, it } from "vitest";

import probe from "../server";

/** A platform with probe, and Ana writing through Kira. */
function probePlatform() {
	const test = createTestPlatform({ modules: [probe] });
	return { test, ana: test.actor("ana", { via: "kira" }) };
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
		const added = test.invoke(ana, "probe.addNote", { body: "comprar pan" }, { key: "k1" });

		expect(test.undo(ana, added.entry, { key: "u1" })).toEqual({
			result: { id: 1, body: "comprar pan" },
			entry: 2,
		});
		expect(test.invoke(ana, "probe.listNotes")).toEqual([]);
	});

	it("undoes editing a note: its previous text is back", async () => {
		const { test, ana } = probePlatform();
		await using _ = test;
		test.invoke(ana, "probe.addNote", { body: "comprar pan" }, { key: "k1" });
		const edited = test.invoke(
			ana,
			"probe.editNote",
			{ id: 1, body: "comprar leche" },
			{ key: "k2" },
		);

		test.undo(ana, edited.entry, { key: "u1" });

		expect(test.invoke(ana, "probe.listNotes")).toEqual([{ id: 1, body: "comprar pan" }]);
	});

	it("undoes deleting a note: it is back with its id and text", async () => {
		const { test, ana } = probePlatform();
		await using _ = test;
		test.invoke(ana, "probe.addNote", { body: "comprar pan" }, { key: "k1" });
		test.invoke(ana, "probe.addNote", { body: "regar" }, { key: "k2" });
		const deleted = test.invoke(ana, "probe.deleteNote", { id: 1 }, { key: "k3" });

		test.undo(ana, deleted.entry, { key: "u1" });

		expect(test.invoke(ana, "probe.listNotes")).toEqual([
			{ id: 1, body: "comprar pan" },
			{ id: 2, body: "regar" },
		]);
	});

	it("leaves one new entry, linked both ways with the one it undoes", async () => {
		const { test, ana } = probePlatform();
		await using _ = test;
		test.invoke(ana, "probe.addNote", { body: "comprar pan" }, { key: "k1" });

		test.undo(ana, 1, { key: "u1" });

		expect(test.log()).toEqual([
			expect.objectContaining({ entry: 1, action: "probe.addNote", undoneBy: 2 }),
			expect.objectContaining({
				entry: 2,
				action: "probe.deleteNote",
				actor: ana,
				key: "u1",
				undoes: 1,
				undoneBy: null,
				input: { id: 1 },
				result: { id: 1, body: "comprar pan" },
				inverse: { action: "probe.restoreNote", input: { id: 1, body: "comprar pan" } },
				touched: [{ module: "probe", type: "note", id: "1" }],
			}),
		]);
	});

	it("never returns an inverse, from a write or from an undo", async () => {
		const { test, ana } = probePlatform();
		await using _ = test;

		const added = test.invoke(ana, "probe.addNote", { body: "comprar pan" }, { key: "k1" });
		const undone = test.undo(ana, added.entry, { key: "u1" });

		expect(Object.keys(added)).toEqual(["result", "entry"]);
		expect(Object.keys(undone)).toEqual(["result", "entry"]);
		expect(JSON.stringify([added, undone])).not.toContain("restoreNote");
	});

	it("answers changed-since when a later entry touched the same note, without change or entry", async () => {
		const { test, ana } = probePlatform();
		await using _ = test;
		test.invoke(ana, "probe.addNote", { body: "comprar pan" }, { key: "k1" });
		test.invoke(ana, "probe.editNote", { id: 1, body: "comprar leche" }, { key: "k2" });

		expect(() => test.undo(ana, 1, { key: "u1" })).toThrow(conflict("changed-since"));
		expect(test.invoke(ana, "probe.listNotes")).toEqual([{ id: 1, body: "comprar leche" }]);
		expect(test.log()).toHaveLength(2);
	});

	it("answers changed-since even when that later change was undone", async () => {
		const { test, ana } = probePlatform();
		await using _ = test;
		test.invoke(ana, "probe.addNote", { body: "comprar pan" }, { key: "k1" });
		test.invoke(ana, "probe.editNote", { id: 1, body: "comprar leche" }, { key: "k2" });
		test.undo(ana, 2, { key: "u1" });

		expect(() => test.undo(ana, 1, { key: "u2" })).toThrow(conflict("changed-since"));
		expect(test.invoke(ana, "probe.listNotes")).toEqual([{ id: 1, body: "comprar pan" }]);
	});

	it("lets another note change in between", async () => {
		const { test, ana } = probePlatform();
		await using _ = test;
		test.invoke(ana, "probe.addNote", { body: "comprar pan" }, { key: "k1" });
		test.invoke(ana, "probe.addNote", { body: "regar" }, { key: "k2" });
		test.invoke(ana, "probe.editNote", { id: 2, body: "regar el olivo" }, { key: "k3" });

		test.undo(ana, 1, { key: "u1" });

		expect(test.invoke(ana, "probe.listNotes")).toEqual([{ id: 2, body: "regar el olivo" }]);
	});

	it("lets the module's rule refuse undoing a note that now has comments, without change or entry", async () => {
		const { test, ana } = probePlatform();
		await using _ = test;
		test.invoke(ana, "probe.addNote", { body: "comprar pan" }, { key: "k1" });
		test.invoke(ana, "probe.addComment", { noteId: 1, body: "integral" }, { key: "k2" });

		expect(() => test.undo(ana, 1, { key: "u1" })).toThrow(
			expect.objectContaining({ code: "NOTE_HAS_COMMENTS" }),
		);
		expect(test.invoke(ana, "probe.listNotes")).toEqual([{ id: 1, body: "comprar pan" }]);
		expect(test.log()).toHaveLength(2);
		expect(test.log()[0]).toHaveProperty("undoneBy", null);
	});

	it("answers irreversible for a write that cannot be undone", async () => {
		const { test, ana } = probePlatform();
		await using _ = test;
		test.invoke(ana, "probe.addNote", { body: "comprar pan" }, { key: "k1" });
		test.invoke(ana, "probe.addComment", { noteId: 1, body: "integral" }, { key: "k2" });
		const deleted = test.invoke(ana, "probe.deleteComment", { id: 1 }, { key: "k3" });

		expect(() => test.undo(ana, deleted.entry, { key: "u1" })).toThrow(irreversible);
		expect(test.log()).toHaveLength(3);
	});

	it("answers not found for an entry that does not exist", async () => {
		const { test, ana } = probePlatform();
		await using _ = test;

		expect(() => test.undo(ana, 7, { key: "u1" })).toThrow(
			expect.objectContaining({ code: "NOT_FOUND" }),
		);
	});

	it("answers a repeated undo with its earlier result and entry, and another key with already-undone", async () => {
		const { test, ana } = probePlatform();
		await using _ = test;
		test.invoke(ana, "probe.addNote", { body: "comprar pan" }, { key: "k1" });
		const first = test.undo(ana, 1, { key: "u1" });

		expect(test.undo(ana, 1, { key: "u1" })).toStrictEqual(first);
		expect(() => test.undo(ana, 1, { key: "u2" })).toThrow(conflict("already-undone"));
		expect(test.log()).toHaveLength(2);
	});

	it("answers key-reused when an undo's key comes with another entry or with its inverse invoked directly", async () => {
		const { test, ana } = probePlatform();
		await using _ = test;
		test.invoke(ana, "probe.addNote", { body: "comprar pan" }, { key: "k1" });
		test.invoke(ana, "probe.addNote", { body: "regar" }, { key: "k2" });
		test.undo(ana, 1, { key: "u1" });

		expect(() => test.undo(ana, 2, { key: "u1" })).toThrow(conflict("key-reused"));
		expect(() => test.invoke(ana, "probe.deleteNote", { id: 1 }, { key: "u1" })).toThrow(
			conflict("key-reused"),
		);
		expect(() => test.undo(ana, 2, { key: "k1" })).toThrow(conflict("key-reused"));
		expect(test.invoke(ana, "probe.listNotes")).toEqual([{ id: 2, body: "regar" }]);
	});

	it("redoes an edit by undoing its undo", async () => {
		const { test, ana } = probePlatform();
		await using _ = test;
		test.invoke(ana, "probe.addNote", { body: "comprar pan" }, { key: "k1" });
		const edited = test.invoke(
			ana,
			"probe.editNote",
			{ id: 1, body: "comprar leche" },
			{ key: "k2" },
		);
		const undone = test.undo(ana, edited.entry, { key: "u1" });

		test.undo(ana, undone.entry, { key: "u2" });

		expect(test.invoke(ana, "probe.listNotes")).toEqual([{ id: 1, body: "comprar leche" }]);
	});

	it("cannot redo adding a comment, whose inverse cannot be undone", async () => {
		const { test, ana } = probePlatform();
		await using _ = test;
		test.invoke(ana, "probe.addNote", { body: "comprar pan" }, { key: "k1" });
		const added = test.invoke(
			ana,
			"probe.addComment",
			{ noteId: 1, body: "integral" },
			{ key: "k2" },
		);
		const undone = test.undo(ana, added.entry, { key: "u1" });

		expect(() => test.undo(ana, undone.entry, { key: "u2" })).toThrow(irreversible);
	});

	it.each([
		["denies", () => "deny" as const],
		[
			"throws",
			() => {
				throw new Error("authorizer down");
			},
		],
	])("does not undo when the authorizer %s", async (_, authorizer) => {
		const { test, ana } = probePlatform();
		await using __ = test;
		test.invoke(ana, "probe.addNote", { body: "comprar pan" }, { key: "k1" });

		test.authorize(authorizer);

		expect(() => test.undo(ana, 1, { key: "u1" })).toThrow(
			expect.objectContaining({ code: "FORBIDDEN" }),
		);
		test.authorize("allow");
		expect(test.invoke(ana, "probe.listNotes")).toEqual([{ id: 1, body: "comprar pan" }]);
		expect(test.log()).toHaveLength(1);
	});

	it("delivers nothing on a repeated undo when the authorizer now denies", async () => {
		const { test, ana } = probePlatform();
		await using _ = test;
		test.invoke(ana, "probe.addNote", { body: "comprar pan" }, { key: "k1" });
		test.undo(ana, 1, { key: "u1" });

		test.authorize("deny");

		expect(() => test.undo(ana, 1, { key: "u1" })).toThrow(
			expect.objectContaining({ code: "FORBIDDEN" }),
		);
	});

	it("asks the authorizer about the inverse, with the context of the entry it undoes, first and on a retry", async () => {
		const { test, ana } = probePlatform();
		await using _ = test;
		test.invoke(ana, "probe.addNote", { body: "comprar pan" }, { key: "k1" });
		const luis = test.actor("luis");
		const requests: unknown[] = [];
		test.authorize((request) => {
			requests.push(request);
			return "allow";
		});

		test.undo(luis, 1, { key: "u1" });
		test.undo(luis, 1, { key: "u1" });

		const request = {
			actor: luis,
			action: "probe.deleteNote",
			input: { id: 1 },
			undoes: { entry: 1, action: "probe.addNote", actor: ana },
		};
		expect(requests).toEqual([request, request]);
	});
});

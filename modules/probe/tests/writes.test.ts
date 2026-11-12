import { createTestPlatform, TEST_START } from "@domus/test-utils";
import { describe, expect, it } from "vitest";

import probe from "../server";
import { comments, notes } from "../server/schema";

/** A platform with probe, and Ana writing through Kira. */
function probePlatform() {
	const test = createTestPlatform({ modules: [probe] });
	return { test, ana: test.member("ana", { via: "kira" }) };
}

describe("probe writes", () => {
	it("adds a note, returns it with its entry number and logs the entry with its inverse", async () => {
		const { test, ana } = probePlatform();
		await using _ = test;

		const added = test.invoke(
			ana,
			"probe.addNote",
			{ body: "comprar pan" },
			{ idempotencyKey: "k1" },
		);

		expect(added).toEqual({ result: { id: 1, body: "comprar pan" }, entry: 1 });
		expect(test.invoke(ana, "probe.listNotes")).toEqual([{ id: 1, body: "comprar pan" }]);
		expect(test.log()).toEqual([
			expect.objectContaining({
				entry: 1,
				action: "probe.addNote",
				actor: { account: "ana", via: "kira" },
				idempotencyKey: "k1",
				at: TEST_START,
				input: { body: "comprar pan" },
				touched: [{ module: "probe", type: "note", id: "1" }],
				inverse: { action: "probe.deleteNote", input: { id: 1 } },
				undoes: null,
				undoneBy: null,
			}),
		]);
	});

	it("edits a note, with the previous text in its inverse", async () => {
		const { test, ana } = probePlatform();
		await using _ = test;
		test.invoke(ana, "probe.addNote", { body: "comprar pan" }, { idempotencyKey: "k1" });

		const edited = test.invoke(
			ana,
			"probe.editNote",
			{ id: 1, body: "comprar leche" },
			{ idempotencyKey: "k2" },
		);

		expect(edited).toEqual({ result: { id: 1, body: "comprar leche" }, entry: 2 });
		expect(test.invoke(ana, "probe.getNote", { id: 1 })).toEqual({
			id: 1,
			body: "comprar leche",
		});
		expect(test.log()[1]).toMatchObject({
			action: "probe.editNote",
			idempotencyKey: "k2",
			touched: [{ module: "probe", type: "note", id: "1" }],
			inverse: { action: "probe.editNote", input: { id: 1, body: "comprar pan" } },
		});
	});

	it("deletes a note, with its restore as the inverse, and restores it with its id", async () => {
		const { test, ana } = probePlatform();
		await using _ = test;
		test.invoke(ana, "probe.addNote", { body: "comprar pan" }, { idempotencyKey: "k1" });

		expect(test.invoke(ana, "probe.deleteNote", { id: 1 }, { idempotencyKey: "k2" })).toEqual({
			result: { id: 1, body: "comprar pan" },
			entry: 2,
		});
		expect(test.invoke(ana, "probe.listNotes")).toEqual([]);

		expect(
			test.invoke(
				ana,
				"probe.restoreNote",
				{ id: 1, body: "comprar pan" },
				{ idempotencyKey: "k3" },
			),
		).toEqual({ result: { id: 1, body: "comprar pan" }, entry: 3 });
		expect(test.invoke(ana, "probe.listNotes")).toEqual([{ id: 1, body: "comprar pan" }]);

		expect(
			test.log().map(({ action, touched, inverse }) => ({ action, touched, inverse })),
		).toEqual([
			expect.objectContaining({ action: "probe.addNote" }),
			{
				action: "probe.deleteNote",
				touched: [{ module: "probe", type: "note", id: "1" }],
				inverse: { action: "probe.restoreNote", input: { id: 1, body: "comprar pan" } },
			},
			{
				action: "probe.restoreNote",
				touched: [{ module: "probe", type: "note", id: "1" }],
				inverse: { action: "probe.deleteNote", input: { id: 1 } },
			},
		]);
	});

	it("adds a comment touching only the comment, and deletes it with no inverse", async () => {
		const { test, ana } = probePlatform();
		await using _ = test;
		test.invoke(ana, "probe.addNote", { body: "comprar pan" }, { idempotencyKey: "k1" });

		expect(
			test.invoke(
				ana,
				"probe.addComment",
				{ noteId: 1, body: "integral" },
				{ idempotencyKey: "k2" },
			),
		).toEqual({ result: { id: 1, noteId: 1, body: "integral" }, entry: 2 });
		expect(
			test.invoke(ana, "probe.deleteComment", { id: 1 }, { idempotencyKey: "k3" }),
		).toEqual({
			result: { id: 1, noteId: 1, body: "integral" },
			entry: 3,
		});
		expect(test.dbFor(probe).select().from(comments).all()).toEqual([]);

		const [, added, deleted] = test.log();
		expect(added).toMatchObject({
			touched: [{ module: "probe", type: "comment", id: "1" }],
			inverse: { action: "probe.deleteComment", input: { id: 1 } },
		});
		expect(deleted).toMatchObject({
			action: "probe.deleteComment",
			touched: [{ module: "probe", type: "comment", id: "1" }],
			inverse: null,
		});
	});

	it("logs the actor as it came: the same account with and without via", async () => {
		const { test } = probePlatform();
		await using _ = test;

		test.invoke(
			test.member("ana"),
			"probe.addNote",
			{ body: "regar" },
			{ idempotencyKey: "k1" },
		);
		test.invoke(
			test.member("ana", { via: "kira" }),
			"probe.addNote",
			{ body: "regar" },
			{ idempotencyKey: "k2" },
		);

		expect(test.log().map((entry) => entry.actor)).toEqual([
			{ account: "ana" },
			{ account: "ana", via: "kira" },
		]);
	});

	it.each([
		["without a key", undefined],
		["with an empty key", { idempotencyKey: "" }],
	])("rejects a write %s, without change or entry", async (_, options) => {
		const { test, ana } = probePlatform();
		await using __ = test;

		expect(() =>
			// @ts-expect-error: a write needs its key.
			test.invoke(ana, "probe.addNote", { body: "comprar pan" }, options),
		).toThrow(expect.objectContaining({ code: "BAD_REQUEST" }));
		expect(test.invoke(ana, "probe.listNotes")).toEqual([]);
		expect(test.log()).toEqual([]);
	});

	it("refuses to delete a note with comments with its contract's error, without change or entry", async () => {
		const { test, ana } = probePlatform();
		await using _ = test;
		test.dbFor(probe).insert(notes).values({ body: "comprar pan" }).run();
		test.dbFor(probe).insert(comments).values({ noteId: 1, body: "integral" }).run();

		expect(() =>
			test.invoke(ana, "probe.deleteNote", { id: 1 }, { idempotencyKey: "k1" }),
		).toThrow(expect.objectContaining({ code: "NOTE_HAS_COMMENTS", defined: true }));
		expect(test.invoke(ana, "probe.listNotes")).toEqual([{ id: 1, body: "comprar pan" }]);
		expect(test.log()).toEqual([]);
	});
});

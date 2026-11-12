// Who reads the action log and who undoes (ADR 0023): reading it answers only the annotation of the represented
// account's own entries; only that same account undoes one, and the inverse passes the whole authorization.
import { createTestPlatform, pendingFrom } from "@domus/test-utils";
import { describe, expect, it } from "vitest";

import probe from "../server";
import * as schema from "../server/schema";

const forbidden = expect.objectContaining({ code: "FORBIDDEN" });
const notFound = expect.objectContaining({ code: "NOT_FOUND" });

/** A platform with probe and the members Ana and Bea. */
function household() {
	const test = createTestPlatform({ modules: [probe] });
	return { test, ana: test.member("ana"), bea: test.member("bea") };
}

describe("reading the log", () => {
	it("answers only the annotations of one's own entries, never their input or inverse", async () => {
		const { test, ana, bea } = household();
		await using _ = test;
		const kira = test.context("ana", { via: "kira" });
		test.invoke(ana, "probe.addNote", { body: "comprar pan" }, { idempotencyKey: "k1" });
		test.invoke(bea, "probe.addNote", { body: "regar" }, { idempotencyKey: "k1" });
		test.invoke(kira, "probe.editNote", { id: 1, body: "pan" }, { idempotencyKey: "k2" });
		test.undo(ana, 3, { idempotencyKey: "u1" });

		expect(test.readLog(ana)).toStrictEqual([
			{
				entry: 1,
				action: "probe.addNote",
				actor: { account: "ana" },
				at: test.clock.now(),
				undoes: null,
				undoneBy: null,
				touched: [{ module: "probe", type: "note", id: "1" }],
			},
			{
				entry: 3,
				action: "probe.editNote",
				actor: { account: "ana", via: "kira" },
				at: test.clock.now(),
				undoes: null,
				undoneBy: 4,
				touched: [{ module: "probe", type: "note", id: "1" }],
			},
			{
				entry: 4,
				action: "probe.editNote",
				actor: { account: "ana" },
				at: test.clock.now(),
				undoes: 3,
				undoneBy: null,
				touched: [{ module: "probe", type: "note", id: "1" }],
			},
		]);
		expect(test.readLog(bea).map(({ entry }) => entry)).toEqual([2]);
	});

	it("through Kira, needs the platform's read delegated", async () => {
		const { test } = household();
		await using _ = test;
		const kira = test.context("ana", { via: "kira" });
		test.invoke(kira, "probe.addNote", { body: "comprar pan" }, { idempotencyKey: "k1" });

		expect(test.readLog(kira).map(({ entry }) => entry)).toEqual([1]);
		test.prepare.delegation("ana", "platform", "read", "no");
		expect(() => test.readLog(kira)).toThrow(forbidden);
	});

	it("through Kira, asks the person when the platform's read is delegated with confirmation", async () => {
		const { test, ana } = household();
		await using _ = test;
		const kira = test.context("ana", { via: "kira" });
		test.invoke(ana, "probe.addNote", { body: "comprar pan" }, { idempotencyKey: "k1" });
		test.prepare.delegation("ana", "platform", "read", "confirm");

		const id = pendingFrom(() => test.readLog(kira));

		expect(test.confirm(ana, id)).toEqual([expect.objectContaining({ entry: 1 })]);
	});
});

describe("undoing", () => {
	it("is not found for another account's entry, and changes nothing", async () => {
		const { test, ana, bea } = household();
		await using _ = test;
		test.invoke(ana, "probe.addNote", { body: "comprar pan" }, { idempotencyKey: "k1" });
		test.invoke(
			ana,
			"probe.setNoteVisibility",
			{ id: 1, visibility: "public" },
			{
				idempotencyKey: "k2",
			},
		);

		expect(() => test.undo(bea, 2, { idempotencyKey: "u1" })).toThrow(notFound);
		expect(() =>
			test.undo(test.context("bea", { via: "kira" }), 2, { idempotencyKey: "u1" }),
		).toThrow(notFound);
		expect(test.log()).toHaveLength(2);
		expect(test.invoke(bea, "probe.listNotes")).toEqual([{ id: 1, body: "comprar pan" }]);
	});

	it("lets the same account undo, by the app, what it wrote through Kira, and the reverse", async () => {
		const { test, ana } = household();
		await using _ = test;
		const kira = test.context("ana", { via: "kira" });
		test.invoke(kira, "probe.addNote", { body: "comprar pan" }, { idempotencyKey: "k1" });
		test.invoke(ana, "probe.addNote", { body: "regar" }, { idempotencyKey: "k2" });

		test.undo(ana, 1, { idempotencyKey: "u1" });
		test.undo(kira, 2, { idempotencyKey: "u2" });

		expect(test.invoke(ana, "probe.listNotes")).toEqual([]);
	});

	it("through Kira, is denied without the inverse's delegation, and changes nothing", async () => {
		const { test, ana } = household();
		await using _ = test;
		const kira = test.context("ana", { via: "kira" });
		test.invoke(ana, "probe.addNote", { body: "comprar pan" }, { idempotencyKey: "k1" });
		test.prepare.delegation("ana", "probe", "write", "no");

		expect(() => test.undo(kira, 1, { idempotencyKey: "u1" })).toThrow(forbidden);
		expect(test.log()).toHaveLength(1);
		expect(test.invoke(ana, "probe.listNotes")).toEqual([{ id: 1, body: "comprar pan" }]);
	});

	it("through Kira, waits for the person when the inverse's delegation asks, and runs once confirmed", async () => {
		const { test, ana } = household();
		await using _ = test;
		const kira = test.context("ana", { via: "kira" });
		test.invoke(ana, "probe.addNote", { body: "comprar pan" }, { idempotencyKey: "k1" });
		test.prepare.delegation("ana", "probe", "write", "confirm");

		const id = pendingFrom(() => test.undo(kira, 1, { idempotencyKey: "u1" }));
		expect(test.invoke(ana, "probe.listNotes")).toHaveLength(1);

		expect(test.confirm(ana, id)).toEqual({ result: { id: 1, body: "comprar pan" }, entry: 2 });
		expect(test.invoke(ana, "probe.listNotes")).toEqual([]);
		expect(test.log()[1]).toEqual(
			expect.objectContaining({ undoes: 1, actor: { account: "ana", via: "kira" } }),
		);
	});

	it("is denied once the account lost the permission the inverse needs", async () => {
		const { test, ana, bea } = household();
		await using _ = test;
		test.invoke(bea, "probe.addBoardNote", { body: "turnos" }, { idempotencyKey: "k1" });
		test.invoke(
			ana,
			"probe.editBoardNote",
			{ id: 1, body: "turnos de cocina" },
			{
				idempotencyKey: "k2",
			},
		);
		test.prepare.grant("ana", "probe.board", "read");

		expect(() => test.undo(ana, 2, { idempotencyKey: "u1" })).toThrow(forbidden);
		expect(test.invoke(bea, "probe.listBoard")).toEqual([{ id: 1, body: "turnos de cocina" }]);
	});

	it("is not found when the inverse's record is no longer seen, and changes nothing", async () => {
		const { test, ana, bea } = household();
		await using _ = test;
		test.invoke(bea, "probe.addBoardNote", { body: "turnos" }, { idempotencyKey: "k1" });
		test.invoke(
			ana,
			"probe.editBoardNote",
			{ id: 1, body: "turnos de cocina" },
			{
				idempotencyKey: "k2",
			},
		);
		// Bea's note turns private outside the log, so no later entry answers changed-since first.
		test.dbFor(probe).update(schema.board).set({ visibility: "private" }).run();

		expect(() => test.undo(ana, 2, { idempotencyKey: "u1" })).toThrow(
			expect.objectContaining({ code: "BOARD_NOTE_NOT_FOUND" }),
		);
		expect(test.log()).toHaveLength(2);
		expect(test.invoke(bea, "probe.listBoard")).toEqual([{ id: 1, body: "turnos de cocina" }]);
	});
});

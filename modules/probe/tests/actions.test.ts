import { createTestPlatform } from "@domus/test-utils";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

import probe from "../server";
import { notes } from "../server/schema";

describe("probe reads", () => {
	it("lists the notes prepared in its tables", async () => {
		await using test = createTestPlatform({ modules: [probe] });
		test.dbFor(probe)
			.insert(notes)
			.values([{ body: "comprar pan" }, { body: "regar" }])
			.run();

		expect(test.invoke(test.member("ana"), "probe.listNotes")).toEqual([
			{ id: 1, body: "comprar pan" },
			{ id: 2, body: "regar" },
		]);
	});

	it("gets one note by its id, and null for an id without a note", async () => {
		await using test = createTestPlatform({ modules: [probe] });
		test.dbFor(probe)
			.insert(notes)
			.values([{ body: "comprar pan" }, { body: "regar" }])
			.run();
		const ana = test.member("ana");

		expect(test.invoke(ana, "probe.getNote", { id: 2 })).toEqual({ id: 2, body: "regar" });
		expect(test.invoke(ana, "probe.getNote", { id: 3 })).toBeNull();
	});

	it("rejects an input its contract does not accept", async () => {
		await using test = createTestPlatform({ modules: [probe] });

		expect(() => test.invoke(test.member("ana"), "probe.getNote", { id: -1 })).toThrow(
			expect.objectContaining({ code: "BAD_REQUEST" }),
		);
	});
});

describe("probe permissions, with the real authorization", () => {
	const forbidden = expect.objectContaining({ code: "FORBIDDEN" });

	// The handler the platform registers is the one in the definition: spied before the platform starts.
	let listNotes: MockInstance;
	beforeEach(() => {
		if (!probe.actions) throw new Error("probe declares its actions");
		listNotes = vi.spyOn(probe.actions, "listNotes");
	});
	afterEach(() => listNotes.mockRestore());

	it("lets a member read and write: write is its default in every area", async () => {
		await using test = createTestPlatform({ modules: [probe] });
		const ana = test.member("ana");

		expect(
			test.invoke(ana, "probe.addNote", { body: "comprar pan" }, { idempotencyKey: "k1" }),
		).toEqual({ result: { id: 1, body: "comprar pan" }, entry: 1 });
		expect(test.invoke(ana, "probe.listNotes")).toEqual([{ id: 1, body: "comprar pan" }]);
	});

	it("lets an admin read and write", async () => {
		await using test = createTestPlatform({ modules: [probe] });
		const paco = test.context(test.prepare.account({ id: "paco", role: "admin" }));

		test.invoke(paco, "probe.addNote", { body: "regar" }, { idempotencyKey: "k1" });
		expect(test.invoke(paco, "probe.listNotes")).toEqual([{ id: 1, body: "regar" }]);
	});

	it("lets the device account read, but not write: read is its default", async () => {
		await using test = createTestPlatform({ modules: [probe] });
		test.dbFor(probe).insert(notes).values({ body: "comprar pan" }).run();
		const kitchen = test.context(test.deviceAccount, { identity: "device" });

		expect(test.invoke(kitchen, "probe.listNotes")).toEqual([{ id: 1, body: "comprar pan" }]);
		expect(() =>
			test.invoke(kitchen, "probe.addNote", { body: "regar" }, { idempotencyKey: "k1" }),
		).toThrow(forbidden);
		expect(test.log()).toEqual([]);
	});

	it("denies, without running the handler, when a row lowers the account to none", async () => {
		await using test = createTestPlatform({ modules: [probe] });
		const ana = test.member("ana");
		test.prepare.grant("ana", "probe", "none");

		expect(() => test.invoke(ana, "probe.listNotes")).toThrow(forbidden);
		expect(() =>
			test.invoke(ana, "probe.addNote", { body: "regar" }, { idempotencyKey: "k1" }),
		).toThrow(forbidden);
		expect(listNotes).not.toHaveBeenCalled();
		expect(test.log()).toEqual([]);
	});

	it("follows a row lowered to read, and raised again, on the same platform", async () => {
		await using test = createTestPlatform({ modules: [probe] });
		const ana = test.member("ana", { via: "kira" });
		test.prepare.grant("ana", "probe", "read");

		expect(test.invoke(ana, "probe.listNotes")).toEqual([]);
		expect(() =>
			test.invoke(ana, "probe.addNote", { body: "regar" }, { idempotencyKey: "k1" }),
		).toThrow(forbidden);

		test.prepare.grant("ana", "probe", "write");

		expect(
			test.invoke(ana, "probe.addNote", { body: "regar" }, { idempotencyKey: "k1" }),
		).toEqual({ result: { id: 1, body: "regar" }, entry: 1 });
	});

	it("denies an account that does not exist", async () => {
		await using test = createTestPlatform({ modules: [probe] });

		expect(() => test.invoke(test.context("nobody"), "probe.listNotes")).toThrow(forbidden);
		expect(listNotes).not.toHaveBeenCalled();
	});
});

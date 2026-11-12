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

		expect(test.invoke(test.actor("ana"), "probe.listNotes")).toEqual([
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
		const ana = test.actor("ana");

		expect(test.invoke(ana, "probe.getNote", { id: 2 })).toEqual({ id: 2, body: "regar" });
		expect(test.invoke(ana, "probe.getNote", { id: 3 })).toBeNull();
	});

	it("rejects an input its contract does not accept", async () => {
		await using test = createTestPlatform({ modules: [probe] });

		expect(() => test.invoke(test.actor("ana"), "probe.getNote", { id: -1 })).toThrow(
			expect.objectContaining({ code: "BAD_REQUEST" }),
		);
	});

	describe("when authorization does not allow it", () => {
		// The handler the platform registers is the one in the definition: spied before the platform starts.
		let listNotes: MockInstance;
		beforeEach(() => {
			if (!probe.actions) throw new Error("probe declares its actions");
			listNotes = vi.spyOn(probe.actions, "listNotes");
		});
		afterEach(() => listNotes.mockRestore());

		it("ends forbidden without running the handler on a denial", async () => {
			await using test = createTestPlatform({ modules: [probe] });
			test.authorize("deny");

			expect(() => test.invoke(test.actor("ana"), "probe.listNotes")).toThrow(
				expect.objectContaining({ code: "FORBIDDEN" }),
			);
			expect(listNotes).not.toHaveBeenCalled();
		});

		it("ends forbidden without running the handler when the authorizer throws", async () => {
			await using test = createTestPlatform({ modules: [probe] });
			test.authorize(() => {
				throw new Error("authorizer down");
			});

			expect(() => test.invoke(test.actor("ana"), "probe.listNotes")).toThrow(
				expect.objectContaining({ code: "FORBIDDEN" }),
			);
			expect(listNotes).not.toHaveBeenCalled();
		});

		it("runs again once the authorizer allows, on the same platform", async () => {
			await using test = createTestPlatform({ modules: [probe] });
			const ana = test.actor("ana", { via: "kira" });
			test.authorize("deny");
			expect(() => test.invoke(ana, "probe.listNotes")).toThrow();

			test.authorize("allow");

			expect(test.invoke(ana, "probe.listNotes")).toEqual([]);
			expect(listNotes).toHaveBeenCalledOnce();
		});
	});
});

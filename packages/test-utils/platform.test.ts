import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { defineModule } from "@domus/module-sdk";
import { readAction } from "@domus/module-sdk/contracts";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";

import { createTestPlatform, TEST_START } from "./platform";

/** A module whose only read echoes the actor and the instant its handler receives. */
const clockwork = defineModule({
	id: "clockwork",
	schema: {},
	migrations: [],
	contract: {
		whoAndWhen: readAction().output(
			z.object({
				actor: z.object({ account: z.string(), via: z.string().optional() }),
				now: z.number(),
			}),
		),
		double: readAction()
			.input(z.object({ value: z.number() }))
			.output(z.number()),
	},
	actions: {
		whoAndWhen: ({ actor, now }) => ({ actor, now }),
		double: ({ input }) => input.value * 2,
	},
});

describe("createTestPlatform with actions", () => {
	it("hands handlers a clock that moves only when the test moves it", async () => {
		await using test = createTestPlatform({ modules: [clockwork] });
		const ana = test.actor("ana");
		expect(test.invoke(ana, "clockwork.whoAndWhen").now).toBe(TEST_START);

		test.clock.advance(1500);
		expect(test.invoke(ana, "clockwork.whoAndWhen").now).toBe(TEST_START + 1500);

		test.clock.set(Date.UTC(2027, 0, 1));
		expect(test.invoke(ana, "clockwork.whoAndWhen").now).toBe(Date.UTC(2027, 0, 1));
		expect(test.clock.now()).toBe(Date.UTC(2027, 0, 1));
	});

	it("makes actors of one account with and without via, and with different via", async () => {
		await using test = createTestPlatform({ modules: [clockwork] });
		const seen = (via?: string) =>
			test.invoke(test.actor("ana", { via }), "clockwork.whoAndWhen").actor;

		expect(seen()).toEqual({ account: "ana" });
		expect(seen("kira")).toEqual({ account: "ana", via: "kira" });
		expect(seen("panel")).toEqual({ account: "ana", via: "panel" });
	});

	it("types invoke with the names, inputs and outputs of the modules it receives", async () => {
		await using test = createTestPlatform({ modules: [clockwork] });
		const ana = test.actor("ana");

		expectTypeOf(test.invoke(ana, "clockwork.double", { value: 2 })).toEqualTypeOf<number>();
		expect(test.invoke(ana, "clockwork.double", { value: 2 })).toBe(4);
		// @ts-expect-error: no module received declares this action.
		expect(() => test.invoke(ana, "clockwork.triple", { value: 2 })).toThrow();
		// @ts-expect-error: the input must match the contract.
		expect(() => test.invoke(ana, "clockwork.double", { value: "2" })).toThrow();
		// @ts-expect-error: an action with input needs it.
		expect(() => test.invoke(ana, "clockwork.double")).toThrow();
	});
});

describe("createTestPlatform", () => {
	it("runs in memory by default and answers through the door", async () => {
		await using test = createTestPlatform({ modules: [] });
		expect(test.databaseFile).toBe(":memory:");
		const response = await test.door.fetch(new Request("http://domus/health"));
		expect(await response.json()).toEqual({ status: "ok" });
	});

	it("applies the migrations of the platform and of the modules it receives", async () => {
		const notes = defineModule({
			id: "notes",
			schema: {},
			migrations: [
				{
					tag: "0000_notes",
					position: 0,
					hash: "hash-of-0000_notes",
					statements: ["CREATE TABLE `notes_items` (`id` integer PRIMARY KEY);"],
				},
			],
		});
		await using test = createTestPlatform({ modules: [notes] });
		expect(test.platform.appliedMigrations).toBe(2);
	});

	it("puts the file in a temporary folder it removes on close", () => {
		const test = createTestPlatform({ modules: [], file: true });
		expect(existsSync(test.databaseFile)).toBe(true);
		test.close();
		expect(existsSync(dirname(test.databaseFile))).toBe(false);
	});

	it("removes its temporary folder at the end of an await using block", async () => {
		let databaseFile: string;
		{
			await using test = createTestPlatform({ modules: [], file: true });
			databaseFile = test.databaseFile;
		}
		expect(existsSync(dirname(databaseFile))).toBe(false);
	});

	it("can be closed more than once, by close and by await using", async () => {
		await using test = createTestPlatform({ modules: [], file: true });
		test.close();
		expect(() => test.close()).not.toThrow();
		await expect(test[Symbol.asyncDispose]()).resolves.toBeUndefined();
	});

	describe("on a file the caller gives", () => {
		let dir: string;
		beforeEach(() => {
			dir = mkdtempSync(join(tmpdir(), "domus-test-utils-"));
		});
		afterEach(() => rmSync(dir, { recursive: true, force: true }));

		it("uses it and keeps it after closing", () => {
			const databaseFile = join(dir, "domus.db");
			const test = createTestPlatform({ modules: [], file: databaseFile });
			expect(test.databaseFile).toBe(databaseFile);
			test.close();
			expect(existsSync(databaseFile)).toBe(true);
		});
	});
});

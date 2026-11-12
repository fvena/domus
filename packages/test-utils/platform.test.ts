import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { defineModule } from "@domus/module-sdk";
import { readAction, writeAction } from "@domus/module-sdk/contracts";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";

import { createTestPlatform, TEST_START } from "./platform";

/** A module whose only read echoes the actor and the instant its handler receives. */
const clockwork = defineModule({
	id: "clockwork",
	schema: {},
	migrations: [],
	contract: {
		whoAndWhen: readAction({ level: "read" }).output(
			z.object({
				actor: z.object({ account: z.string(), via: z.string().optional() }),
				now: z.number(),
			}),
		),
		double: readAction({ level: "read" })
			.input(z.object({ value: z.number() }))
			.output(z.number()),
		/** A write that changes nothing but is logged. */
		tick: writeAction({ undoable: false, level: "write" })
			.input(z.object({ value: z.number() }))
			.output(z.number()),
	},
	actions: {
		whoAndWhen: ({ actor, now }) => ({ actor, now }),
		double: ({ input }) => input.value * 2,
		tick: ({ input }) => ({ result: input.value, touched: [] }),
	},
});

describe("createTestPlatform with actions", () => {
	it("hands handlers a clock that moves only when the test moves it", async () => {
		await using test = createTestPlatform({ modules: [clockwork] });
		const ana = test.member("ana");
		expect(test.invoke(ana, "clockwork.whoAndWhen").now).toBe(TEST_START);

		test.clock.advance(1500);
		expect(test.invoke(ana, "clockwork.whoAndWhen").now).toBe(TEST_START + 1500);

		test.clock.set(Date.UTC(2027, 0, 1));
		expect(test.invoke(ana, "clockwork.whoAndWhen").now).toBe(Date.UTC(2027, 0, 1));
		expect(test.clock.now()).toBe(Date.UTC(2027, 0, 1));
	});

	it("hands handlers the actor of a synthetic context: its account and via, nothing else", async () => {
		await using test = createTestPlatform({ modules: [clockwork] });
		const seen = (via?: string) =>
			test.invoke(test.member("ana", { via }), "clockwork.whoAndWhen").actor;

		expect(seen()).toEqual({ account: "ana" });
		expect(seen("kira")).toEqual({ account: "ana", via: "kira" });
		expect(seen("panel")).toEqual({ account: "ana", via: "panel" });
	});

	it("decides with the real authorization: an account without a role is denied", async () => {
		await using test = createTestPlatform({ modules: [clockwork] });

		expect(() => test.invoke(test.context("nobody"), "clockwork.double", { value: 2 })).toThrow(
			expect.objectContaining({ code: "FORBIDDEN" }),
		);
	});

	it("prepares accounts with their role, and rows that replace a role's default", async () => {
		await using test = createTestPlatform({ modules: [clockwork] });
		const paco = test.context(test.prepare.account({ id: "paco", role: "admin" }));
		const ana = test.member("ana");
		const kitchen = test.context(test.deviceAccount);
		const tick = (context: typeof ana, key: string) =>
			test.invoke(context, "clockwork.tick", { value: 1 }, { idempotencyKey: key });

		expect(tick(paco, "k1").entry).toBe(1);
		expect(tick(ana, "k1").entry).toBe(2);
		expect(() => tick(kitchen, "k1")).toThrow(expect.objectContaining({ code: "FORBIDDEN" }));

		test.prepare.grant("ana", "clockwork", "read");
		test.prepare.grant(test.deviceAccount, "clockwork", "write");

		expect(() => tick(ana, "k2")).toThrow(expect.objectContaining({ code: "FORBIDDEN" }));
		expect(tick(kitchen, "k2").entry).toBe(3);
	});

	it("prepares delegation rows that Kira's calls follow, and reads the table through the real operation", async () => {
		const guarded = defineModule({
			id: "guarded",
			areas: { "guarded.private": { alwaysPrivate: true } },
			schema: {},
			migrations: [],
		});
		await using test = createTestPlatform({ modules: [clockwork, guarded] });
		const kira = test.member("ana", { via: "kira" });
		const paco = test.context(test.prepare.account({ id: "paco", role: "admin" }));

		expect(test.invoke(kira, "clockwork.double", { value: 2 })).toBe(4);
		test.prepare.delegation("ana", "clockwork", "read", "no");
		expect(() => test.invoke(kira, "clockwork.double", { value: 2 })).toThrow(
			expect.objectContaining({ code: "FORBIDDEN" }),
		);
		expect(test.delegation(test.context("ana"), "ana").clockwork).toEqual({
			read: "no",
			write: "yes",
			manage: "no",
		});
		// The device account has nothing in an always private area, so it delegates nothing there.
		expect(test.delegation(paco, test.deviceAccount)["guarded.private"]).toEqual({
			read: "no",
			write: "no",
			manage: "no",
		});
	});

	it("rejects a prepared account whose id or email is taken", async () => {
		await using test = createTestPlatform({ modules: [clockwork] });
		test.prepare.account({ id: "ana", role: "member" });

		expect(() =>
			test.prepare.account({ id: "ana", role: "admin", email: "x@domus.test" }),
		).toThrow();
		expect(() =>
			test.prepare.account({ id: "ana2", role: "member", email: "ana@domus.test" }),
		).toThrow();
	});

	it("makes synthetic contexts with any combination of their fields", async () => {
		await using test = createTestPlatform({ modules: [clockwork] });

		expect(test.context("ana")).toStrictEqual({
			account: "ana",
			device: "test-device",
			session: "test-session",
			deviceAccount: "ana",
			channel: "app",
			identity: "password",
		});
		// A member recognized by voice on a shared screen signed in with the device account.
		expect(
			test.context("ana", {
				via: "kira",
				device: "kitchen",
				session: undefined,
				deviceAccount: test.deviceAccount,
				channel: "contexto",
				identity: "voice",
				conversation: "c1",
			}),
		).toStrictEqual({
			account: "ana",
			via: "kira",
			device: "kitchen",
			deviceAccount: test.deviceAccount,
			channel: "contexto",
			identity: "voice",
			conversation: "c1",
		});
	});

	it("gives a prepared account a password it signs in with through the door", async () => {
		await using test = createTestPlatform({ modules: [clockwork] });
		test.prepare.account({ id: "ana", role: "member" });
		await test.prepare.password("ana", "a long password");
		const browser = test.browser();

		expect((await browser.signIn("ana@domus.test", "a wrong password")).status).toBe(401);
		expect((await browser.signIn("ana@domus.test", "a long password")).status).toBe(200);
		expect(Object.keys(browser.cookies()).sort()).toEqual([
			"better-auth.session_token",
			"domus.device",
		]);
	});

	it("types invoke with the names, inputs and outputs of the modules it receives", async () => {
		await using test = createTestPlatform({ modules: [clockwork] });
		const ana = test.member("ana");

		expectTypeOf(test.invoke(ana, "clockwork.double", { value: 2 })).toEqualTypeOf<number>();
		expect(test.invoke(ana, "clockwork.double", { value: 2 })).toBe(4);
		// @ts-expect-error: no module received declares this action.
		expect(() => test.invoke(ana, "clockwork.triple", { value: 2 })).toThrow();
		// @ts-expect-error: the input must match the contract.
		expect(() => test.invoke(ana, "clockwork.double", { value: "2" })).toThrow();
		// @ts-expect-error: an action with input needs it.
		expect(() => test.invoke(ana, "clockwork.double")).toThrow();
		// @ts-expect-error: a read takes no key.
		test.invoke(ana, "clockwork.double", { value: 2 }, { idempotencyKey: "k1" });
	});

	it("types a write: it takes its key and returns its result and entry number, or an acknowledgement", async () => {
		await using test = createTestPlatform({ modules: [clockwork] });
		const ana = test.member("ana");

		const written = test.invoke(ana, "clockwork.tick", { value: 7 }, { idempotencyKey: "k1" });

		expectTypeOf(written).toEqualTypeOf<
			| { readonly result: number; readonly entry: number }
			| { readonly entry: number; readonly repeated: true }
		>();
		expect(written).toEqual({ result: 7, entry: 1 });
		expect(
			test.invoke(ana, "clockwork.tick", { value: 7 }, { idempotencyKey: "k1" }),
		).toStrictEqual({ entry: 1, repeated: true });
		// @ts-expect-error: a write needs its key.
		expect(() => test.invoke(ana, "clockwork.tick", { value: 7 })).toThrow();
	});

	it("gives a read-only snapshot of the action log that the test cannot change", async () => {
		await using test = createTestPlatform({ modules: [clockwork] });
		test.invoke(test.member("ana"), "clockwork.tick", { value: 7 }, { idempotencyKey: "k1" });

		const snapshot = test.log();
		// @ts-expect-error: the snapshot is read-only.
		snapshot[0]!.idempotencyKey = "changed";

		expect(test.log()).toEqual([
			expect.objectContaining({ entry: 1, idempotencyKey: "k1", input: { value: 7 } }),
		]);
	});
});

describe("createTestPlatform", () => {
	it("runs in memory by default and answers through the door", async () => {
		await using test = createTestPlatform({ modules: [] });
		expect(test.databaseFile).toBe(":memory:");
		const response = await test.door.fetch(new Request("http://domus/health"));
		expect(await response.json()).toEqual({ status: "ok", background: { status: "ok" } });
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
		await using bare = createTestPlatform({ modules: [] });
		await using test = createTestPlatform({ modules: [notes] });
		// The platform's own, which apply with no module, and the module's.
		expect(bare.platform.appliedMigrations).toBeGreaterThanOrEqual(2);
		expect(test.platform.appliedMigrations).toBe(bare.platform.appliedMigrations + 1);
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

// Via Kira (ADR 0023, ADR 0034): the delegation table lowers and never widens the person's permission, over the
// synthetic verified context with `via` on the path of the actions; the person confirms what it asked from the app.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { clientFor } from "@domus/api-client";
import { createTestPlatform, pendingFrom, platformContract, TEST_ORIGIN } from "@domus/test-utils";
import { describe, expect, it } from "vitest";

import { probeContract } from "../contracts";
import probe from "../server";

const forbidden = expect.objectContaining({ code: "FORBIDDEN" });

/** What a new member delegates in an area: read and write copied from its `write`, manage denied. */
const MEMBER_START = { read: "yes", write: "yes", manage: "no" };

describe("probe via Kira, with the delegation table", () => {
	it("denies a level the account delegates as no, without running anything", async () => {
		await using test = createTestPlatform({ modules: [probe] });
		const ana = test.member("ana", { via: "kira" });
		test.prepare.delegation("ana", "probe", "write", "no");

		expect(test.invoke(ana, "probe.listNotes")).toEqual([]);
		expect(() =>
			test.invoke(ana, "probe.addNote", { body: "regar" }, { idempotencyKey: "k1" }),
		).toThrow(forbidden);
		expect(test.log()).toEqual([]);
	});

	it("allows a level the account delegates as yes, and still applies its own no without via", async () => {
		await using test = createTestPlatform({ modules: [probe] });
		test.member("ana");
		test.prepare.delegation("ana", "probe", "read", "no");
		test.prepare.delegation("ana", "probe", "write", "yes");
		const kira = test.context("ana", { via: "kira" });

		expect(() => test.invoke(kira, "probe.listNotes")).toThrow(forbidden);
		expect(
			test.invoke(kira, "probe.addNote", { body: "regar" }, { idempotencyKey: "k1" }),
		).toEqual({ result: { id: 1, body: "regar" }, entry: 1 });
		expect(test.invoke(test.context("ana"), "probe.listNotes")).toEqual([
			{ id: 1, body: "regar", files: [] },
		]);
	});

	it("asks for confirmation on confirm, reads at once on yes in the same area, and runs once confirmed from the app", async () => {
		await using test = createTestPlatform({ modules: [probe] });
		const kira = test.member("ana", { via: "kira" });
		test.prepare.delegation("ana", "probe", "write", "confirm");

		const pending = pendingFrom(() =>
			test.invoke(kira, "probe.addNote", { body: "regar" }, { idempotencyKey: "k1" }),
		);
		expect(test.invoke(kira, "probe.listNotes")).toEqual([]);
		expect(test.log()).toEqual([]);

		expect(test.confirm(test.context("ana"), pending)).toEqual({
			result: { id: 1, body: "regar" },
			entry: 1,
		});
		expect(test.invoke(kira, "probe.listNotes")).toEqual([{ id: 1, body: "regar", files: [] }]);
		// Born via Kira, it is logged via Kira, under the key Kira gave.
		expect(test.log()).toMatchObject([{ actor: { account: "ana", via: "kira" } }]);
	});

	it("applies the delegation of its origin when it is confirmed from the app: taking it away denies", async () => {
		await using test = createTestPlatform({ modules: [probe] });
		const kira = test.member("ana", { via: "kira" });
		test.prepare.delegation("ana", "probe", "write", "confirm");
		const pending = pendingFrom(() =>
			test.invoke(kira, "probe.addNote", { body: "regar" }, { idempotencyKey: "k1" }),
		);

		test.prepare.delegation("ana", "probe", "write", "no");

		expect(() => test.confirm(test.context("ana"), pending)).toThrow(forbidden);
		expect(test.log()).toEqual([]);
		// The denial leaves it waiting: giving the delegation back lets it run.
		test.prepare.delegation("ana", "probe", "write", "confirm");
		expect(test.confirm(test.context("ana"), pending)).toMatchObject({ entry: 1 });
	});

	it("never goes past the account's permission, whatever it delegates", async () => {
		await using test = createTestPlatform({ modules: [probe] });
		const ana = test.member("ana", { via: "kira" });
		test.prepare.grant("ana", "probe", "read");
		test.prepare.delegation("ana", "probe", "write", "yes");

		expect(test.invoke(ana, "probe.listNotes")).toEqual([]);
		expect(() =>
			test.invoke(ana, "probe.addNote", { body: "regar" }, { idempotencyKey: "k1" }),
		).toThrow(forbidden);
	});

	it("applies the delegation's no, yes and confirm at each level, manage included", async () => {
		await using test = createTestPlatform({ modules: [probe] });
		const kira = test.member("ana", { via: "kira" });
		test.prepare.grant("ana", "probe", "manage");
		let keys = 0;
		const calls = {
			read: () => test.invoke(kira, "probe.listNotes"),
			write: () =>
				test.invoke(
					kira,
					"probe.addNote",
					{ body: "leche" },
					{ idempotencyKey: `k${++keys}` },
				),
			manage: () =>
				test.invoke(
					kira,
					"probe.configure",
					{ visibility: "public" },
					{ idempotencyKey: `k${++keys}` },
				),
		} as const;

		const seen: Record<string, string> = {};
		for (const level of ["read", "write", "manage"] as const)
			for (const value of ["no", "yes", "confirm"] as const) {
				test.prepare.delegation("ana", "probe", level, value);
				seen[`${level} ${value}`] = outcome(calls[level]);
			}
		expect(seen).toEqual({
			"read no": "FORBIDDEN",
			"read yes": "ok",
			"read confirm": "CONFIRMATION_REQUIRED",
			"write no": "FORBIDDEN",
			"write yes": "ok",
			"write confirm": "CONFIRMATION_REQUIRED",
			"manage no": "FORBIDDEN",
			// A manage action delegated still needs its proof, which no context with via brings.
			"manage yes": "STEP_UP_REQUIRED",
			"manage confirm": "CONFIRMATION_REQUIRED",
		});
	});

	it("denies an area without a row: a module that arrives later is closed to Kira", async () => {
		const folder = mkdtempSync(join(tmpdir(), "domus-delegation-"));
		try {
			const file = join(folder, "domus.db");
			{
				await using before = createTestPlatform({ modules: [], file });
				before.prepare.account({ id: "ana", role: "member" });
			}
			await using test = createTestPlatform({ modules: [probe], file });

			expect(() =>
				test.invoke(test.context("ana", { via: "kira" }), "probe.listNotes"),
			).toThrow(forbidden);
			// Without via, the person's own permission in the new area applies.
			expect(test.invoke(test.context("ana"), "probe.listNotes")).toEqual([]);
		} finally {
			rmSync(folder, { recursive: true, force: true });
		}
	});

	it("hides another's private record, and answers forbidden to what the delegation denies", async () => {
		await using test = createTestPlatform({ modules: [probe] });
		const kira = test.member("ana", { via: "kira" });
		test.invoke(
			test.member("luis"),
			"probe.addNote",
			{ body: "secreto" },
			{ idempotencyKey: "k1" },
		);

		expect(test.invoke(kira, "probe.listNotes")).toEqual([]);
		expect(test.invoke(kira, "probe.getNote", { id: 1 })).toBeNull();
		expect(() =>
			test.invoke(kira, "probe.editNote", { id: 1, body: "visto" }, { idempotencyKey: "k2" }),
		).toThrow(expect.objectContaining({ code: "NOTE_NOT_FOUND" }));

		test.prepare.delegation("ana", "probe", "write", "no");
		expect(() =>
			test.invoke(kira, "probe.editNote", { id: 1, body: "visto" }, { idempotencyKey: "k3" }),
		).toThrow(forbidden);
	});
});

describe("a pending confirmation via Kira, confirmed by the person from the app over HTTP", () => {
	const PASSWORD = "correct horse battery staple";

	/** Ana, with a password, signed in on a browser of her own: a session other than the agent's. */
	async function anaSignedIn() {
		const test = createTestPlatform({ modules: [probe] });
		test.prepare.account({ id: "ana", role: "member" });
		await test.prepare.password("ana", PASSWORD);
		const browser = test.browser();
		expect((await browser.signIn("ana@domus.test", PASSWORD)).status).toBe(200);
		const app = clientFor(
			{ ...platformContract, probe: probeContract },
			{ baseUrl: TEST_ORIGIN, fetch: browser.fetch },
		);
		return { test, app, kira: test.context("ana", { via: "kira" }) };
	}

	it("keeps the delegation it was born with, and its entry the via of its origin", async () => {
		const { test, app, kira } = await anaSignedIn();
		await using _ = test;
		test.prepare.delegation("ana", "probe", "write", "confirm");
		const pending = pendingFrom(() =>
			test.invoke(kira, "probe.addNote", { body: "leche" }, { idempotencyKey: "k1" }),
		);
		expect(test.log()).toEqual([]);

		test.prepare.delegation("ana", "probe", "write", "no");
		await expect(app.confirmations.confirm({ id: pending })).rejects.toMatchObject({
			code: "FORBIDDEN",
		});
		test.prepare.delegation("ana", "probe", "write", "confirm");
		expect(await app.confirmations.confirm({ id: pending })).toEqual({
			result: { id: 1, body: "leche" },
			entry: 1,
		});
		expect(test.log()).toMatchObject([{ actor: { account: "ana", via: "kira" } }]);
	});
});

/** The code of what a call threw, or `"ok"` when it went through. */
function outcome(call: () => unknown): string {
	try {
		call();
		return "ok";
	} catch (error) {
		return String((error as { code?: unknown }).code);
	}
}

describe("the delegation table of a new account", () => {
	it("copies read and write from the account's permission, with manage denied and nothing to confirm", async () => {
		await using test = createTestPlatform({ modules: [probe] });
		const ana = test.member("ana");
		const paco = test.context(test.prepare.account({ id: "paco", role: "admin" }));

		const memberStart = Object.fromEntries(
			["platform", "probe", "probe.board", "probe.health", "probe.secret"].map((area) => [
				area,
				MEMBER_START,
			]),
		);
		expect(test.delegation(ana, "ana")).toEqual(memberStart);
		expect(test.delegation(paco, "paco")).toEqual(memberStart);
		// The device account has nothing in the always private areas, so it delegates nothing there.
		const nothing = { read: "no", write: "no", manage: "no" };
		expect(test.delegation(paco, test.deviceAccount)).toEqual({
			platform: { read: "yes", write: "no", manage: "no" },
			probe: { read: "yes", write: "no", manage: "no" },
			"probe.board": { read: "yes", write: "no", manage: "no" },
			"probe.health": nothing,
			"probe.secret": nothing,
		});
	});

	it("does not follow a permission raised later: Kira does not gain it by itself", async () => {
		await using test = createTestPlatform({ modules: [probe] });
		const paco = test.context(test.prepare.account({ id: "paco", role: "admin" }));
		const before = test.delegation(paco, test.deviceAccount);
		test.prepare.grant(test.deviceAccount, "probe", "write");

		expect(test.delegation(paco, test.deviceAccount)).toEqual(before);
		const kitchen = test.context(test.deviceAccount, { identity: "device" });
		const kira = test.context(test.deviceAccount, { identity: "device", via: "kira" });
		expect(
			test.invoke(kitchen, "probe.addNote", { body: "regar" }, { idempotencyKey: "k1" }),
		).toEqual({ result: { id: 1, body: "regar" }, entry: 1 });
		expect(() =>
			test.invoke(kira, "probe.addNote", { body: "fregar" }, { idempotencyKey: "k2" }),
		).toThrow(forbidden);
	});
});

describe("reading the delegation", () => {
	it("lets each person read their own, with what the preparation set", async () => {
		await using test = createTestPlatform({ modules: [probe] });
		const ana = test.member("ana");
		test.prepare.delegation("ana", "probe", "write", "confirm");

		expect(test.delegation(ana, "ana").probe).toEqual({
			read: "yes",
			write: "confirm",
			manage: "no",
		});
	});

	it("lets the admin read the device account's, and nobody else's", async () => {
		await using test = createTestPlatform({ modules: [probe] });
		const paco = test.context(test.prepare.account({ id: "paco", role: "admin" }));
		const ana = test.member("ana");

		expect(test.delegation(paco, test.deviceAccount).probe).toEqual({
			read: "yes",
			write: "no",
			manage: "no",
		});
		expect(() => test.delegation(paco, "ana")).toThrow(forbidden);
		expect(() => test.delegation(ana, "paco")).toThrow(forbidden);
		expect(() => test.delegation(ana, test.deviceAccount)).toThrow(forbidden);
	});

	it("is denied via Kira, whatever the platform's read delegation says, and asks nobody", async () => {
		await using test = createTestPlatform({ modules: [probe] });
		const ana = test.member("ana");
		const kira = test.context("ana", { via: "kira" });

		for (const value of ["yes", "confirm"] as const) {
			test.prepare.delegation("ana", "platform", "read", value);
			expect(() => test.delegation(kira, "ana")).toThrow(forbidden);
		}
		expect(test.pendingConfirmations()).toEqual([]);
		expect(test.delegation(ana, "ana").probe).toEqual(MEMBER_START);
	});
});

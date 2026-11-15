import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type ContextOptions, createTestPlatform, pendingFrom } from "@domus/test-utils";
import { describe, expect, it } from "vitest";

import probe from "../server";

const SECOND = 1000;
const EXPIRY = 24 * 60 * 60 * SECOND;

const conflict = (reason: string) =>
	expect.objectContaining({ code: "CONFLICT", data: { reason } });
const notFound = expect.objectContaining({ code: "NOT_FOUND" });
const forbidden = expect.objectContaining({ code: "FORBIDDEN" });

/** Kira, for Ana, on her phone. */
const KIRA: ContextOptions = { via: "kira", device: "ana-phone", session: "ana-phone-session" };

/** A platform with probe where Ana's writes through Kira ask her to confirm. */
function household() {
	const test = createTestPlatform({ modules: [probe] });
	test.member("ana");
	test.prepare.delegation("ana", "probe", "write", "confirm");
	return {
		test,
		/** Ana herself, from the app. */
		ana: test.context("ana"),
		/** Kira, for Ana, on her phone. */
		kira: test.context("ana", KIRA),
	};
}

describe("asking for confirmation", () => {
	it("answers the same pending confirmation to the same write repeated, and runs nothing", async () => {
		const { test, kira } = household();
		await using _ = test;
		const add = () =>
			test.invoke(kira, "probe.addNote", { body: "regar" }, { idempotencyKey: "k1" });

		const first = pendingFrom(add);

		expect(pendingFrom(add)).toBe(first);
		expect(test.log()).toEqual([]);
		expect(test.invoke(test.context("ana"), "probe.listNotes")).toEqual([]);
	});

	it("answers the same pending confirmation to the same read repeated in the same session", async () => {
		const { test, kira } = household();
		await using _ = test;
		test.prepare.delegation("ana", "probe", "read", "confirm");

		const first = pendingFrom(() => test.invoke(kira, "probe.listNotes"));

		expect(pendingFrom(() => test.invoke(kira, "probe.listNotes"))).toBe(first);
		expect(
			pendingFrom(() =>
				test.invoke(
					test.context("ana", { ...KIRA, session: "kitchen" }),
					"probe.listNotes",
				),
			),
		).not.toBe(first);
	});

	it("never answers the same pending read to two reads without session", async () => {
		const { test } = household();
		await using _ = test;
		test.prepare.delegation("ana", "probe", "read", "confirm");
		const sessionless = test.context("ana", { ...KIRA, session: undefined });

		const first = pendingFrom(() => test.invoke(sessionless, "probe.listNotes"));

		expect(pendingFrom(() => test.invoke(sessionless, "probe.listNotes"))).not.toBe(first);
	});

	it("answers key-reused to the same key with another input or another action", async () => {
		const { test, kira } = household();
		await using _ = test;
		pendingFrom(() =>
			test.invoke(kira, "probe.addNote", { body: "regar" }, { idempotencyKey: "k1" }),
		);

		expect(() =>
			test.invoke(kira, "probe.addNote", { body: "podar" }, { idempotencyKey: "k1" }),
		).toThrow(conflict("key-reused"));
		expect(() =>
			test.invoke(kira, "probe.addBoardNote", { body: "regar" }, { idempotencyKey: "k1" }),
		).toThrow(conflict("key-reused"));
	});

	it("asks only once for deleteComment, which always asks, even when the delegation asks too", async () => {
		const { test, ana, kira } = household();
		await using _ = test;
		test.invoke(ana, "probe.addNote", { body: "comprar pan" }, { idempotencyKey: "k1" });
		test.invoke(
			ana,
			"probe.addComment",
			{ noteId: 1, body: "integral" },
			{ idempotencyKey: "k2" },
		);

		const pending = pendingFrom(() =>
			test.invoke(kira, "probe.deleteComment", { id: 1 }, { idempotencyKey: "k3" }),
		);

		expect(test.confirm(ana, pending)).toEqual({
			result: { id: 1, noteId: 1, body: "integral" },
			entry: 3,
		});
	});
});

describe("confirming", () => {
	it("works by the app from another session of the same account, and is not found for another account", async () => {
		const { test, kira } = household();
		await using _ = test;
		const pending = pendingFrom(() =>
			test.invoke(kira, "probe.addNote", { body: "regar" }, { idempotencyKey: "k1" }),
		);

		expect(() => test.confirm(test.member("luis"), pending)).toThrow(notFound);
		expect(test.confirm(test.context("ana", { session: "another-session" }), pending)).toEqual({
			result: { id: 1, body: "regar" },
			entry: 1,
		});
	});

	it("is denied, and so is rejecting, to a context with via, from any device: it stays unconsumed", async () => {
		const { test, ana, kira } = household();
		await using _ = test;
		const pending = pendingFrom(() =>
			test.invoke(kira, "probe.addNote", { body: "regar" }, { idempotencyKey: "k1" }),
		);
		const stored = test.pendingConfirmations();

		for (const agent of [kira, test.context("ana", { via: "kira" })]) {
			expect(() => test.confirm(agent, pending)).toThrow(forbidden);
			expect(() => test.reject(agent, pending)).toThrow(forbidden);
		}
		expect(test.pendingConfirmations()).toEqual(stored);
		expect(test.log()).toEqual([]);
		expect(test.confirm(ana, pending)).toMatchObject({ entry: 1 });
	});

	it("expires at the exact millisecond of its expiry", async () => {
		const { test, ana, kira } = household();
		await using _ = test;
		const early = pendingFrom(() =>
			test.invoke(kira, "probe.addNote", { body: "regar" }, { idempotencyKey: "k1" }),
		);
		const late = pendingFrom(() =>
			test.invoke(kira, "probe.addNote", { body: "podar" }, { idempotencyKey: "k2" }),
		);
		test.clock.advance(EXPIRY - 1);

		expect(test.confirm(ana, early)).toMatchObject({ entry: 1 });
		test.clock.advance(1);
		expect(() => test.confirm(ana, late)).toThrow(conflict("confirmation-expired"));
		expect(() => test.reject(ana, late)).toThrow(conflict("confirmation-expired"));
	});

	it("runs a write once: a second confirmation answers confirmation-consumed", async () => {
		const { test, ana, kira } = household();
		await using _ = test;
		const pending = pendingFrom(() =>
			test.invoke(kira, "probe.addNote", { body: "regar" }, { idempotencyKey: "k1" }),
		);

		test.confirm(ana, pending);

		expect(() => test.confirm(ana, pending)).toThrow(conflict("confirmation-consumed"));
		expect(test.invoke(ana, "probe.listNotes")).toEqual([{ id: 1, body: "regar", files: [] }]);
		expect(test.log()).toHaveLength(1);
		// The same request again is the write already done: its acknowledgement.
		expect(
			test.invoke(kira, "probe.addNote", { body: "regar" }, { idempotencyKey: "k1" }),
		).toEqual({ entry: 1, repeated: true });
	});

	it("runs a read once, answering its result only then; the next confirmation is consumed", async () => {
		const { test, ana, kira } = household();
		await using _ = test;
		test.prepare.delegation("ana", "probe", "read", "confirm");
		test.invoke(ana, "probe.addNote", { body: "regar" }, { idempotencyKey: "k1" });
		const pending = pendingFrom(() => test.invoke(kira, "probe.listNotes"));

		expect(test.confirm(ana, pending)).toEqual([{ id: 1, body: "regar", files: [] }]);
		expect(() => test.confirm(ana, pending)).toThrow(conflict("confirmation-consumed"));
		// A new read asks again.
		expect(pendingFrom(() => test.invoke(kira, "probe.listNotes"))).not.toBe(pending);
	});

	it("rejects: nothing runs and it cannot be confirmed after", async () => {
		const { test, ana, kira } = household();
		await using _ = test;
		const pending = pendingFrom(() =>
			test.invoke(kira, "probe.addNote", { body: "regar" }, { idempotencyKey: "k1" }),
		);

		expect(() => test.reject(test.member("luis"), pending)).toThrow(notFound);
		test.reject(ana, pending);

		expect(() => test.confirm(ana, pending)).toThrow(conflict("confirmation-consumed"));
		expect(() => test.reject(ana, pending)).toThrow(conflict("confirmation-consumed"));
		expect(test.log()).toEqual([]);
		expect(test.invoke(ana, "probe.listNotes")).toEqual([]);
	});

	it("runs exactly the operation it was asked for, not another action or input", async () => {
		const { test, ana, kira } = household();
		await using _ = test;
		const watering = pendingFrom(() =>
			test.invoke(kira, "probe.addNote", { body: "regar" }, { idempotencyKey: "k1" }),
		);
		const pruning = pendingFrom(() =>
			test.invoke(kira, "probe.addNote", { body: "podar" }, { idempotencyKey: "k2" }),
		);

		expect(pruning).not.toBe(watering);
		expect(test.confirm(ana, watering)).toEqual({ result: { id: 1, body: "regar" }, entry: 1 });
		expect(test.invoke(ana, "probe.listNotes")).toEqual([{ id: 1, body: "regar", files: [] }]);
	});

	it("undoes through a confirmation when the inverse asks for one", async () => {
		const { test, ana } = household();
		await using _ = test;
		test.invoke(ana, "probe.addNote", { body: "comprar pan" }, { idempotencyKey: "k1" });
		const added = test.invoke(
			ana,
			"probe.addComment",
			{ noteId: 1, body: "integral" },
			{ idempotencyKey: "k2" },
		);
		const undo = () => test.undo(ana, added.entry, { idempotencyKey: "u1" });
		const pending = pendingFrom(undo);

		expect(pendingFrom(undo)).toBe(pending);
		expect(() => test.undo(ana, 1, { idempotencyKey: "u1" })).toThrow(conflict("key-reused"));
		expect(test.confirm(ana, pending)).toMatchObject({ entry: 3 });
		expect(test.invoke(ana, "probe.notesWithComments")).toEqual([]);
		expect(undo()).toEqual({ entry: 3, repeated: true });
	});
});

describe("pending confirmations across a restart", () => {
	it("keep their expiry, which new options do not change", async () => {
		const folder = mkdtempSync(join(tmpdir(), "domus-confirmations-"));
		const file = join(folder, "domus.db");
		try {
			let pending: string;
			{
				await using test = createTestPlatform({ modules: [probe], file });
				test.member("ana");
				test.prepare.delegation("ana", "probe", "write", "confirm");
				const kira = test.context("ana", KIRA);
				pending = pendingFrom(() =>
					test.invoke(kira, "probe.addNote", { body: "regar" }, { idempotencyKey: "k1" }),
				);
			}

			await using test = createTestPlatform({
				modules: [probe],
				file,
				confirmation: { expiry: 10 * EXPIRY },
			});
			test.clock.advance(EXPIRY);
			expect(() => test.confirm(test.context("ana"), pending)).toThrow(
				conflict("confirmation-expired"),
			);
		} finally {
			rmSync(folder, { recursive: true, force: true });
		}
	});
});

describe("probe.health on the shared device", () => {
	const PASSWORD = "correct horse battery staple";

	/**
	 * A platform where Ana has a health record and Paco, the admin, opened probe.health to the device account by
	 * mistake; the kitchen screen is signed in with the device account.
	 */
	async function kitchen() {
		const test = createTestPlatform({ modules: [probe] });
		test.prepare.account({ id: "paco", role: "admin" });
		await test.prepare.password("paco", PASSWORD);
		const ana = test.member("ana");
		test.invoke(ana, "probe.recordHealth", { body: "tensión 12/8" }, { idempotencyKey: "k1" });
		const paco = test.context("paco");
		const opened = {
			account: test.deviceAccount,
			area: "probe.health",
			level: "read",
		} as const;
		const { proof } = await test.requestProof(paco, PASSWORD, {
			action: "platform.setPermission",
			input: opened,
		});
		test.setPermission(paco, opened, { idempotencyKey: "p1", proof });
		return {
			test,
			ana,
			/** The device account itself, on the kitchen screen. */
			screen: test.context(test.deviceAccount, {
				device: "kitchen-screen",
				identity: "device",
			}),
		};
	}

	it("is not read by the device account, even with the area opened by the admin", async () => {
		const { test, screen } = await kitchen();
		await using _ = test;

		expect(() => test.invoke(screen, "probe.readHealth")).toThrow(forbidden);
		expect(test.pendingConfirmations()).toEqual([]);
	});

	it("is read by a member on her own device, with nothing to confirm", async () => {
		const { test, ana } = await kitchen();
		await using _ = test;

		expect(test.invoke(ana, "probe.readHealth")).toEqual([{ id: 1, body: "tensión 12/8" }]);
	});

	it("does not apply to probe.secret, always private without the rule", async () => {
		const { test, ana, screen } = await kitchen();
		await using _ = test;
		test.invoke(ana, "probe.recordSecret", { body: "clave" }, { idempotencyKey: "k2" });

		expect(() => test.invoke(screen, "probe.readSecret")).toThrow(forbidden);
		expect(test.invoke(ana, "probe.readSecret")).toEqual([{ id: 1, body: "clave" }]);
	});
});

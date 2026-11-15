import { createTestPlatform, pendingFrom, TEST_START } from "@domus/test-utils";
import { describe, expect, it } from "vitest";

import probe from "../server";

const DAY = 24 * 60 * 60 * 1000;
/** 04:30 in Madrid on the 31st day after the test's start (CET, +01:00): the content of the start's writes expired. */
const CLEANUP_AFTER_EXPIRY = TEST_START + 30 * DAY + 3.5 * 60 * 60 * 1000;

/**
 * A platform with probe and Ana: one note written at the start, whose content expires at 30 days, and another
 * one written on the 29th day, still undoable when the cleanup runs.
 */
async function withExpiredAndCurrentEntries() {
	const test = createTestPlatform({ modules: [probe] });
	const ana = test.member("ana");
	const old = test.invoke(
		ana,
		"probe.addNote",
		{ body: "comprar pan" },
		{ idempotencyKey: "k1" },
	);
	test.clock.set(TEST_START + 29 * DAY);
	const current = test.invoke(ana, "probe.addNote", { body: "regar" }, { idempotencyKey: "k2" });
	return { test, ana, old: old.entry, current: current.entry };
}

/** Starts the background and moves the clock to the cleanup after the first entry expired. */
async function runCleanup(test: ReturnType<typeof createTestPlatform>) {
	test.background.start();
	test.clock.set(CLEANUP_AFTER_EXPIRY);
	await test.background.settled();
	expect(test.background.runs()).toEqual([
		expect.objectContaining({ task: "cleanup", result: "ok" }),
	]);
}

const expired = expect.objectContaining({
	code: "UNPROCESSABLE_CONTENT",
	data: { reason: "expired" },
});
const irreversible = expect.objectContaining({
	code: "UNPROCESSABLE_CONTENT",
	data: { reason: "irreversible" },
});
const conflict = (reason: string) => ({ code: "CONFLICT", data: { reason } });
const PASSWORD = "correct horse battery staple";
const CONFIGURE = { action: "probe.configure", input: { visibility: "public" } } as const;

/** What a call answers, comparable before and after cleaning: its value, or its error's code and data. */
function outcomeOf(call: () => unknown): unknown {
	try {
		return call();
	} catch (error) {
		const { code, data } = error as { code?: unknown; data?: unknown };
		return { code, data };
	}
}

describe("the cleanup of the action log", () => {
	it("empties the input and inverse of an expired entry, and leaves a current one whole", async () => {
		const { test, old, current } = await withExpiredAndCurrentEntries();
		await using _ = test;
		const before = test.log();

		await runCleanup(test);

		const after = test.log();
		expect(after.find((entry) => entry.entry === old)).toEqual({
			...before.find((entry) => entry.entry === old),
			input: undefined,
			inverse: null,
		});
		expect(after.find((entry) => entry.entry === current)).toEqual(
			before.find((entry) => entry.entry === current),
		);
	});

	it("still acknowledges a repeated write whose content it emptied, and the account still reads its annotation", async () => {
		const { test, ana, old } = await withExpiredAndCurrentEntries();
		await using _ = test;
		test.clock.set(CLEANUP_AFTER_EXPIRY - 1);
		const repeat = () =>
			test.invoke(ana, "probe.addNote", { body: "comprar pan" }, { idempotencyKey: "k1" });
		const answerBefore = repeat();
		const annotationsBefore = test.readLog(ana);

		await runCleanup(test);

		expect(repeat()).toStrictEqual(answerBefore);
		expect(answerBefore).toStrictEqual({ entry: old, repeated: true });
		expect(test.readLog(ana)).toEqual(annotationsBefore);
		expect(test.invoke(ana, "probe.listNotes")).toHaveLength(2);
	});

	it("answers an undo of an emptied entry as it answered before: expired, or irreversible", async () => {
		const { test, ana, old } = await withExpiredAndCurrentEntries();
		await using _ = test;
		test.clock.set(TEST_START);
		const health = test.invoke(
			ana,
			"probe.recordHealth",
			{ body: "tensión" },
			{ idempotencyKey: "k3" },
		);
		test.clock.set(CLEANUP_AFTER_EXPIRY - 1);
		expect(() => test.undo(ana, old, { idempotencyKey: "u1" })).toThrow(expired);
		expect(() => test.undo(ana, health.entry, { idempotencyKey: "u2" })).toThrow(irreversible);

		await runCleanup(test);

		expect(() => test.undo(ana, old, { idempotencyKey: "u3" })).toThrow(expired);
		expect(() => test.undo(ana, health.entry, { idempotencyKey: "u4" })).toThrow(irreversible);
	});

	it("cleans nothing more the second time", async () => {
		const { test } = await withExpiredAndCurrentEntries();
		await using _ = test;
		await runCleanup(test);
		const once = test.log();

		test.clock.set(CLEANUP_AFTER_EXPIRY + DAY);
		await test.background.settled();

		expect(test.background.runs()).toHaveLength(2);
		expect(test.log()).toEqual(once);
	});
});

/** Kira for Ana, in a conversation on her phone: her writes through Kira ask her to confirm. */
const KIRA = {
	via: "kira",
	device: "ana-phone",
	session: undefined,
	channel: "contexto",
	identity: "password",
	conversation: "c1",
} as const;

describe("the cleanup of pending confirmations", () => {
	it("empties the operation of an expired one, whatever its state, and leaves a current one whole", async () => {
		await using test = createTestPlatform({ modules: [probe] });
		const ana = test.member("ana");
		test.prepare.delegation("ana", "probe", "write", "confirm");
		const kira = test.context("ana", KIRA);
		const add = (body: string, key: string) =>
			pendingFrom(() =>
				test.invoke(kira, "probe.addNote", { body }, { idempotencyKey: key }),
			);
		const consumed = add("regar", "k1");
		test.confirm(ana, consumed);
		add("podar", "k2");
		test.clock.set(CLEANUP_AFTER_EXPIRY - 60 * 60 * 1000);
		add("barrer", "k3");
		const before = test.pendingConfirmations();

		await runCleanup(test);

		expect(before.every((row) => typeof row["operation"] === "string")).toBe(true);
		expect(test.pendingConfirmations()).toEqual([
			{ ...before[0], operation: null },
			{ ...before[1], operation: null },
			before[2],
		]);
	});

	it("answers the same before and after: consumed, rejected, expired, ended with its session, and a repeat", async () => {
		await using test = createTestPlatform({ modules: [probe] });
		test.prepare.account({ id: "ana", role: "member" });
		await test.prepare.password("ana", PASSWORD);
		test.prepare.delegation("ana", "probe", "write", "confirm");
		const phone = test.prepare.session("ana");
		const laptop = test.prepare.session("ana");
		const ana = test.context("ana", laptop);
		const kira = test.context("ana", KIRA);
		const add = (body: string, key: string) =>
			test.invoke(kira, "probe.addNote", { body }, { idempotencyKey: key });
		const consumed = pendingFrom(() => add("regar", "k1"));
		test.confirm(ana, consumed);
		const rejected = pendingFrom(() => add("podar", "k2"));
		test.reject(ana, rejected);
		const expiredOne = pendingFrom(() => add("barrer", "k3"));
		const onPhone = pendingFrom(() =>
			test.invoke(
				test.context("ana", { ...KIRA, ...phone }),
				"probe.addNote",
				{ body: "fregar" },
				{ idempotencyKey: "k4" },
			),
		);
		const revoke = { session: phone.session };
		const { proof } = await test.requestProof(ana, PASSWORD, {
			action: "platform.revokeSession",
			input: revoke,
		});
		test.revokeSession(ana, phone.session, { idempotencyKey: "r1", proof });
		test.clock.set(CLEANUP_AFTER_EXPIRY - 1);
		const answers = () => [
			outcomeOf(() => test.confirm(ana, consumed)),
			outcomeOf(() => test.reject(ana, rejected)),
			outcomeOf(() => test.confirm(ana, expiredOne)),
			outcomeOf(() => test.confirm(ana, onPhone)),
			outcomeOf(() => add("regar", "k1")),
			outcomeOf(() => add("otra", "k3")),
		];
		const before = answers();

		await runCleanup(test);

		expect(answers()).toEqual(before);
		expect(before).toEqual([
			conflict("confirmation-consumed"),
			conflict("confirmation-consumed"),
			conflict("confirmation-expired"),
			conflict("confirmation-expired"),
			{ entry: 1, repeated: true },
			conflict("key-reused"),
		]);
	});
});

describe("the cleanup of step-up proofs", () => {
	it("answers the same before and after: a repeat with its used proof, an expired one and one whose session ended", async () => {
		await using test = createTestPlatform({ modules: [probe] });
		test.prepare.account({ id: "paco", role: "admin" });
		await test.prepare.password("paco", PASSWORD);
		const phone = test.prepare.session("paco");
		// No real session: a prepared one would have expired by the cleanup, and ended its used proof with it.
		const paco = test.context("paco");
		const fromPhone = test.context("paco", phone);
		test.invoke(paco, "probe.addNote", { body: "comprar pan" }, { idempotencyKey: "n1" });
		const ask = async (context: typeof paco) =>
			(await test.requestProof(context, PASSWORD, CONFIGURE)).proof;
		const configure = (context: typeof paco, key: string, proof: string) =>
			test.invoke(context, "probe.configure", CONFIGURE.input, {
				idempotencyKey: key,
				proof,
			});
		const used = await ask(paco);
		configure(paco, "c1", used);
		const unused = await ask(paco);
		const onPhone = await ask(fromPhone);
		const revoke = { session: phone.session };
		test.revokeSession(paco, phone.session, {
			idempotencyKey: "r1",
			proof: (
				await test.requestProof(paco, PASSWORD, {
					action: "platform.revokeSession",
					input: revoke,
				})
			).proof,
		});
		test.clock.set(CLEANUP_AFTER_EXPIRY - 1);
		const answers = () => [
			outcomeOf(() => configure(paco, "c1", used)),
			outcomeOf(() => configure(paco, "c2", unused)),
			outcomeOf(() => configure(fromPhone, "c3", onPhone)),
		];
		const before = answers();

		await runCleanup(test);

		expect(answers()).toEqual(before);
		expect(before).toEqual([
			{ entry: 2, repeated: true },
			{ code: "STEP_UP_REQUIRED", data: undefined },
			{ code: "STEP_UP_REQUIRED", data: undefined },
		]);
	});
});

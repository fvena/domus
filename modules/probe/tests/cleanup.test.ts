import { createTestPlatform, TEST_START } from "@domus/test-utils";
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

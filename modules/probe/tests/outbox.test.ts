// The outbox (spec of phase 1d4, «La bandeja de salida»): a job a write leaves in its own transaction. It exists
// only if that write commits, carries the write's log entry and its data, runs only after the commit, and the
// entry's undo cancels it while it has not started. Before the notices exist, the test leaves a synthetic job
// from a probe handler it wraps, through the testing entry.
import { createTestPlatform, type SyntheticJob, type TestPlatform } from "@domus/test-utils";
import { afterEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { z } from "zod";

import probe from "../server";

type Probe = TestPlatform<readonly [typeof probe]>;

/** A synthetic job with data, `{ to }`, whose every attempt waits until the test ends it. */
function mailJob() {
	const attempts: { readonly payload: unknown; readonly succeed: () => void }[] = [];
	const job: SyntheticJob = {
		lane: "short",
		payload: z.object({ to: z.string() }),
		run: ({ payload }) =>
			new Promise<void>((resolve) => {
				attempts.push({ payload, succeed: resolve });
			}),
	};
	return { job, attempts };
}

const spies: MockInstance[] = [];
afterEach(() => {
	for (const spy of spies.splice(0)) spy.mockRestore();
});

/**
 * Makes each run of `addNote` leave a `mail` job to `to` in its write, and then, if `fail`, throw as a write that
 * breaks later would. The platform registers the definition's handler, so this goes before the platform opens; the
 * job goes through the test platform the getter gives once it exists.
 */
function addNoteLeavesMail(platform: () => Probe, { fail = false } = {}): void {
	const actions = probe.actions as Record<string, (context: never) => unknown>;
	const original = actions.addNote;
	if (!original) throw new Error("probe has no addNote");
	spies.push(
		vi.spyOn(actions, "addNote").mockImplementation((context) => {
			const outcome = original(context);
			platform().background.enqueueInWrite("mail", { to: "paco" });
			if (fail) throw new Error("a failure after the handler's work");
			return outcome;
		}),
	);
}

/** A platform with probe, the `mail` job and Ana; `addNote` leaves a mail in its write. */
function household(options: { readonly fail?: boolean } = {}) {
	const mail = mailJob();
	let test: Probe | undefined;
	addNoteLeavesMail(() => {
		if (!test) throw new Error("the platform is not open yet");
		return test;
	}, options);
	test = createTestPlatform({ modules: [probe], jobs: { mail: mail.job } });
	return { test, mail, ana: test.member("ana") };
}

describe("a job left in a write", () => {
	it("exists once the write commits, with the write's entry and its data, and runs only after the commit", async () => {
		const { test, mail, ana } = household();
		await using _ = test;
		test.background.start();

		const added = test.invoke(ana, "probe.addNote", { body: "pan" }, { idempotencyKey: "k1" });
		expect(mail.attempts).toHaveLength(0);

		expect(test.background.jobs()).toEqual([
			expect.objectContaining({
				kind: "mail",
				lane: "short",
				state: "pending",
				entry: added.entry,
				payload: { to: "paco" },
				outcome: null,
			}),
		]);
		await test.background.flush();
		expect(mail.attempts).toEqual([expect.objectContaining({ payload: { to: "paco" } })]);
		mail.attempts[0]?.succeed();
		await test.background.settled();
		expect(test.background.jobs()).toEqual([
			expect.objectContaining({ kind: "mail", state: "done", entry: added.entry }),
		]);
	});

	it("does not exist when the write rolls back", async () => {
		const { test, mail, ana } = household({ fail: true });
		await using _ = test;
		test.background.start();

		expect(() =>
			test.invoke(ana, "probe.addNote", { body: "pan" }, { idempotencyKey: "k1" }),
		).toThrow(expect.objectContaining({ code: "INTERNAL_SERVER_ERROR" }));
		await test.background.flush();

		expect(test.background.jobs()).toEqual([]);
		expect(mail.attempts).toHaveLength(0);
	});

	it("is not left again by a repeat of the write with the same key, which answers an acknowledgement", async () => {
		const { test, ana } = household();
		await using _ = test;
		const added = test.invoke(ana, "probe.addNote", { body: "pan" }, { idempotencyKey: "k1" });

		expect(
			test.invoke(ana, "probe.addNote", { body: "pan" }, { idempotencyKey: "k1" }),
		).toEqual({ entry: added.entry, repeated: true });

		expect(test.background.jobs()).toEqual([
			expect.objectContaining({ kind: "mail", entry: added.entry }),
		]);
	});

	it("cannot be left outside a write's handler", async () => {
		const { test } = household();
		await using _ = test;

		expect(() => test.background.enqueueInWrite("mail", { to: "paco" })).toThrow(
			"a job is left only inside a write's handler",
		);
		expect(test.background.jobs()).toEqual([]);
	});
});

describe("undoing the write that left a job", () => {
	it("cancels it while pending, with the reason undone, and it never runs", async () => {
		const { test, mail, ana } = household();
		await using _ = test;
		const added = test.invoke(ana, "probe.addNote", { body: "pan" }, { idempotencyKey: "k1" });

		test.undo(ana, added.entry, { idempotencyKey: "u1" });
		test.background.start();
		await test.background.runDue();

		expect(mail.attempts).toHaveLength(0);
		expect(test.background.jobs()).toEqual([
			expect.objectContaining({
				kind: "mail",
				state: "cancelled",
				error: "undone",
				entry: added.entry,
			}),
		]);
	});

	it("does not cancel it once claimed: the job goes on and ends well", async () => {
		const { test, mail, ana } = household();
		await using _ = test;
		test.background.start();
		const added = test.invoke(ana, "probe.addNote", { body: "pan" }, { idempotencyKey: "k1" });
		await test.background.flush();
		expect(mail.attempts).toHaveLength(1);

		test.undo(ana, added.entry, { idempotencyKey: "u1" });
		expect(test.background.jobs()).toEqual([
			expect.objectContaining({ kind: "mail", state: "running" }),
		]);

		mail.attempts[0]?.succeed();
		await test.background.settled();
		expect(test.invoke(ana, "probe.listNotes")).toEqual([]);
		expect(test.background.jobs()).toEqual([
			expect.objectContaining({ kind: "mail", state: "done", error: null }),
		]);
	});

	it("leaves the cancelled job to the cleanup of old jobs, whose own job carries no data and no entry", async () => {
		const { test, ana } = household();
		await using _ = test;
		const added = test.invoke(ana, "probe.addNote", { body: "pan" }, { idempotencyKey: "k1" });
		test.undo(ana, added.entry, { idempotencyKey: "u1" });
		test.background.start();

		test.clock.advance(31 * 24 * 60 * 60 * 1000);
		await test.background.settled();

		expect(test.background.jobs()).toEqual([
			expect.objectContaining({
				kind: "cleanup",
				state: "done",
				payload: null,
				entry: null,
				outcome: null,
			}),
		]);
	});

	it("cancels only the jobs of its own entry", async () => {
		const { test, ana } = household();
		await using _ = test;
		const first = test.invoke(ana, "probe.addNote", { body: "pan" }, { idempotencyKey: "k1" });
		const second = test.invoke(ana, "probe.addNote", { body: "sal" }, { idempotencyKey: "k2" });

		test.undo(ana, first.entry, { idempotencyKey: "u1" });

		expect(test.background.jobs()).toEqual([
			expect.objectContaining({ entry: first.entry, state: "cancelled" }),
			expect.objectContaining({ entry: second.entry, state: "pending" }),
		]);
	});
});

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PermanentJobError } from "@domus/platform/testing";
import { describe, expect, it, onTestFinished } from "vitest";

import { createTestPlatform, type SyntheticJob } from "./platform";

const SECOND = 1000;

/** A synthetic job whose every attempt waits until the test ends it, and that counts its attempts. */
function heldJob(lane: SyntheticJob["lane"]) {
	const attempts: {
		readonly signal: AbortSignal;
		readonly succeed: () => void;
		readonly fail: (error: unknown) => void;
	}[] = [];
	const job: SyntheticJob = {
		lane,
		run: ({ signal }) =>
			new Promise<void>((resolve, reject) => {
				attempts.push({ signal, succeed: resolve, fail: reject });
			}),
	};
	return {
		job,
		attempts,
		/** How many attempts have started. */
		get started() {
			return attempts.length;
		},
		/** The latest attempt. */
		get current() {
			const last = attempts[attempts.length - 1];
			if (!last) throw new Error("no attempt has started");
			return last;
		},
	};
}

describe("the synthetic jobs of the background control", () => {
	it("runs a short job while a long maintenance one holds its lane, and one job at a time in each lane", async () => {
		const long = heldJob("maintenance");
		const other = heldJob("maintenance");
		const short = heldJob("short");
		const second = heldJob("short");
		await using test = createTestPlatform({
			modules: [],
			jobs: { long: long.job, other: other.job, short: short.job, second: second.job },
		});
		test.background.start();

		test.background.enqueue("long");
		test.background.enqueue("other");
		test.background.enqueue("short");
		test.background.enqueue("second");
		await test.background.flush();

		expect([long.started, other.started, short.started, second.started]).toEqual([1, 0, 1, 0]);

		short.current.succeed();
		await test.background.flush();
		expect([long.started, other.started, short.started, second.started]).toEqual([1, 0, 1, 1]);

		second.current.succeed();
		long.current.succeed();
		await test.background.flush();
		expect(other.started).toBe(1);
		other.current.succeed();
		await test.background.settled();

		expect(test.background.jobs().map(({ kind, state }) => ({ kind, state }))).toEqual([
			{ kind: "long", state: "done" },
			{ kind: "other", state: "done" },
			{ kind: "short", state: "done" },
			{ kind: "second", state: "done" },
		]);
	});

	it("cancels a job when its maximum time runs out and, as it ends on the cancellation, retries it", async () => {
		const short = heldJob("short");
		await using test = createTestPlatform({ modules: [], jobs: { short: short.job } });
		test.background.start();
		test.background.enqueue("short");
		await test.background.flush();

		test.clock.advance(30 * SECOND - 1);
		expect(short.current.signal.aborted).toBe(false);
		test.clock.advance(1);
		expect(short.current.signal.aborted).toBe(true);

		short.current.fail(short.current.signal.reason);
		await test.background.flush();
		expect(test.background.jobs()).toEqual([
			expect.objectContaining({
				state: "pending",
				attempts: 1,
				runAt: test.clock.now() + 30 * SECOND,
				error: "timed out after 30000 ms",
			}),
		]);

		test.clock.advance(30 * SECOND);
		await test.background.flush();
		expect(short.started).toBe(2);
		short.current.succeed();
		await test.background.settled();
		expect(test.background.jobs()).toEqual([
			expect.objectContaining({ state: "done", attempts: 2 }),
		]);
	});

	it("leaves stuck a job that ignores its cancellation, keeps its lane taken while it runs, and frees it when it ends", async () => {
		const stubborn = heldJob("maintenance");
		const next = heldJob("maintenance");
		await using test = createTestPlatform({
			modules: [],
			jobs: { stubborn: { ...stubborn.job, timeout: 60 * SECOND }, next: next.job },
		});
		test.background.start();
		test.background.enqueue("stubborn");
		test.background.enqueue("next");
		await test.background.flush();

		test.clock.advance(60 * SECOND);
		expect(stubborn.current.signal.aborted).toBe(true);
		test.clock.advance(10 * SECOND - 1);
		expect(test.background.jobs()[0]).toMatchObject({ kind: "stubborn", state: "running" });
		test.clock.advance(1);
		expect(test.background.jobs()[0]).toMatchObject({ kind: "stubborn", state: "stuck" });

		test.clock.advance(60 * 60 * SECOND);
		await test.background.flush();
		expect(next.started).toBe(0);

		stubborn.current.succeed();
		await test.background.flush();
		expect(test.background.jobs()[0]).toMatchObject({ kind: "stubborn", state: "done" });
		expect(next.started).toBe(1);
		next.current.succeed();
	});

	it("retries a passing error after 30 s, doubling the wait, and leaves it failed after 5 attempts", async () => {
		const flaky = heldJob("short");
		await using test = createTestPlatform({ modules: [], jobs: { flaky: flaky.job } });
		test.background.start();
		test.background.enqueue("flaky");
		await test.background.flush();

		for (const [index, wait] of [30, 60, 120, 240].entries()) {
			flaky.current.fail(new Error("the network is down"));
			await test.background.flush();
			test.clock.advance(wait * SECOND - 1);
			await test.background.flush();
			expect(flaky.started).toBe(index + 1);
			test.clock.advance(1);
			await test.background.flush();
		}
		expect(flaky.started).toBe(5);

		flaky.current.fail(new Error("the network is down"));
		await test.background.settled();
		// Two hours, before the cleanup of 04:30.
		test.clock.advance(2 * 60 * 60 * SECOND);
		await test.background.flush();
		expect(flaky.started).toBe(5);
		expect(test.background.jobs()).toEqual([
			expect.objectContaining({ state: "failed", attempts: 5, error: "Error" }),
		]);
	});

	it("fails a permanent error at once, keeping its message", async () => {
		const broken = heldJob("maintenance");
		await using test = createTestPlatform({ modules: [], jobs: { broken: broken.job } });
		test.background.start();
		test.background.enqueue("broken");
		await test.background.flush();

		broken.current.fail(new PermanentJobError("the snapshot does not exist"));
		await test.background.settled();
		// Two hours, before the cleanup of 04:30.
		test.clock.advance(2 * 60 * 60 * SECOND);
		await test.background.flush();

		expect(broken.started).toBe(1);
		expect(test.background.jobs()).toEqual([
			expect.objectContaining({
				state: "failed",
				attempts: 1,
				error: "PermanentJobError: the snapshot does not exist",
			}),
		]);
	});

	it("keeps no message of an error that may quote personal data, only its name and code", async () => {
		const leaky = heldJob("maintenance");
		await using test = createTestPlatform({ modules: [], jobs: { leaky: leaky.job } });
		test.background.start();
		test.background.enqueue("leaky");
		await test.background.flush();

		leaky.current.fail(
			Object.assign(new Error("UNIQUE failed for ana@example.com"), {
				code: "SQLITE_CONSTRAINT",
			}),
		);
		await test.background.flush();

		expect(test.background.jobs()[0]?.error).toBe("Error SQLITE_CONSTRAINT");
	});

	it("stops leaving running a job that does not end within the margin, and the next start recovers it", async () => {
		const folder = mkdtempSync(join(tmpdir(), "domus-jobs-"));
		onTestFinished(() => rmSync(folder, { recursive: true, force: true }));
		const file = join(folder, "domus.db");
		const stubborn = heldJob("maintenance");
		const before = createTestPlatform({ modules: [], file, jobs: { stubborn: stubborn.job } });
		before.background.start();
		before.background.enqueue("stubborn");
		await before.background.flush();

		let stopped = false;
		const stopping = before.background.stop().then(() => (stopped = true));
		expect(stubborn.current.signal.aborted).toBe(true);
		before.clock.advance(5 * SECOND - 1);
		await before.background.flush();
		expect(stopped).toBe(false);
		before.clock.advance(1);
		await stopping;
		expect(before.background.jobs()).toEqual([
			expect.objectContaining({ state: "running", attempts: 1 }),
		]);
		before.close();
		stubborn.current.succeed();

		await using after = createTestPlatform({
			modules: [],
			file,
			jobs: { stubborn: stubborn.job },
		});
		after.background.start();
		await after.background.flush();
		expect(stubborn.started).toBe(2);
		stubborn.current.succeed();
		await after.background.settled();
		expect(after.background.jobs()).toEqual([
			expect.objectContaining({ state: "done", attempts: 2 }),
		]);
	});
});

import { describe, expect, it } from "vitest";

import { createTestPlatform, type TestPlatform } from "./platform";

const at = (iso: string) => Date.parse(iso);

describe("the background control of createTestPlatform", () => {
	it("runs the daily cleanup at 04:30 in Madrid and records the run with its result", async () => {
		await using test = createTestPlatform({ modules: [] });
		test.background.start();

		// 04:29 in Madrid (CET, +01:00): nothing is due yet.
		test.clock.set(at("2026-01-01T03:29:00Z"));
		await test.background.settled();
		expect(test.background.runs()).toEqual([]);

		test.clock.set(at("2026-01-01T03:30:00Z"));
		await test.background.settled();
		expect(test.background.runs()).toEqual([
			expect.objectContaining({
				task: "cleanup",
				plannedDate: "2026-01-01",
				plannedAt: at("2026-01-01T03:30:00Z"),
				result: "ok",
			}),
		]);
	});

	it("stops with a job in progress: cancels it, waits until it ends, and only then lets the database close", async () => {
		let started!: () => void;
		const running = new Promise<void>((resolve) => (started = resolve));
		let release!: () => void;
		const released = new Promise<void>((resolve) => (release = resolve));
		let seen: AbortSignal | undefined;
		await using test = createTestPlatform({
			modules: [],
			tasks: [
				{
					id: "slow",
					frequency: { every: "day", at: "02:00" },
					job: {
						lane: "maintenance",
						run: async ({ signal }) => {
							seen = signal;
							started();
							await released;
							signal.throwIfAborted();
						},
					},
				},
			],
		});
		test.background.start();
		test.clock.set(at("2026-01-01T01:00:00Z"));
		await running;

		let stopped = false;
		const stopping = test.background.stop().then(() => (stopped = true));
		expect(seen?.aborted).toBe(true);
		await Promise.resolve();
		expect(stopped).toBe(false);
		expect(() => test.close()).toThrow(/stop the background/);

		release();
		await stopping;
		expect(test.background.runs()).toEqual([
			expect.objectContaining({ task: "slow", result: "cancelled" }),
		]);
		test.close();
	});

	describe("with a task of the test, every day at 02:30", () => {
		const nightly = {
			id: "nightly",
			frequency: { every: "day", at: "02:30" },
			job: { lane: "maintenance", run: () => {} },
		} as const;
		const planned = (test: TestPlatform) =>
			test.background
				.runs()
				.filter((run) => run.task === "nightly")
				.map(({ plannedDate, plannedAt, result }) => ({ plannedDate, plannedAt, result }));

		it("runs at 03:00 the last Sunday of March, when 02:30 does not exist", async () => {
			await using test = createTestPlatform({ modules: [], tasks: [nightly] });
			test.clock.set(at("2026-03-28T12:00:00Z"));
			test.background.start();

			test.clock.set(at("2026-03-29T00:59:00Z"));
			await test.background.settled();
			expect(planned(test)).toEqual([]);

			test.clock.set(at("2026-03-29T01:00:00Z"));
			await test.background.settled();
			expect(planned(test)).toEqual([
				{ plannedDate: "2026-03-29", plannedAt: at("2026-03-29T01:00:00Z"), result: "ok" },
			]);
		});

		it("runs once the last Sunday of October, at the first appearance of 02:30", async () => {
			await using test = createTestPlatform({ modules: [], tasks: [nightly] });
			test.clock.set(at("2026-10-24T12:00:00Z"));
			test.background.start();

			// 02:30 CEST, then 02:30 CET an hour later, then 02:30 CET the day after.
			for (const instant of [
				"2026-10-25T00:30:00Z",
				"2026-10-25T01:30:00Z",
				"2026-10-26T01:30:00Z",
			]) {
				test.clock.set(at(instant));
				await test.background.settled();
			}

			expect(planned(test)).toEqual([
				{ plannedDate: "2026-10-25", plannedAt: at("2026-10-25T00:30:00Z"), result: "ok" },
				{ plannedDate: "2026-10-26", plannedAt: at("2026-10-26T01:30:00Z"), result: "ok" },
			]);
		});
	});
});

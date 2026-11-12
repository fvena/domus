import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ScheduledTask } from "@domus/platform/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTestPlatform, type TestPlatform } from "./platform";

const at = (iso: string) => Date.parse(iso);

/** A task of the test that does nothing, every day at `time`. */
const daily = (id: string, time: string): ScheduledTask => ({
	id,
	frequency: { every: "day", at: time },
	job: { lane: "maintenance", run: () => {} },
});

describe("the state of the scheduled tasks across restarts, on a file", () => {
	let databaseFile: string;
	let dir: string;
	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "domus-background-"));
		databaseFile = join(dir, "domus.db");
	});
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	/** Opens the platform on the file at `instant`, with `tasks`, and starts its background. */
	const open = (instant: number, tasks: readonly ScheduledTask[]) => {
		const test = createTestPlatform({ modules: [], file: databaseFile, tasks });
		test.clock.set(instant);
		test.background.start();
		return test;
	};
	const stateOf = (test: TestPlatform, id: string) =>
		test.background.tasks().find((task) => task.id === id);

	it("keeps the chosen time, the pause and the next run after closing and opening again", async () => {
		{
			await using test = open(at("2026-01-01T00:00:00Z"), [
				daily("chosen", "02:30"),
				daily("held", "02:30"),
			]);
			test.background.setTime("chosen", "05:00");
			test.background.pause("held");
		}

		await using test = open(at("2026-01-01T02:00:00Z"), [
			daily("chosen", "02:30"),
			daily("held", "02:30"),
		]);
		expect(stateOf(test, "chosen")).toEqual({
			id: "chosen",
			time: "05:00",
			paused: false,
			nextAt: at("2026-01-01T04:00:00Z"),
		});
		expect(stateOf(test, "held")).toEqual(
			expect.objectContaining({ paused: true, time: null }),
		);
	});

	it("runs a task at the time the admin chose, even when the code changes its default", async () => {
		{
			await using test = open(at("2026-01-01T00:00:00Z"), [daily("chosen", "02:30")]);
			test.background.setTime("chosen", "05:00");
		}

		await using test = open(at("2026-01-01T00:00:00Z"), [daily("chosen", "03:15")]);
		for (const instant of [
			"2026-01-01T02:15:00Z",
			"2026-01-01T04:00:00Z",
			"2026-01-02T04:00:00Z",
		]) {
			test.clock.set(at(instant));
			await test.background.settled();
		}

		expect(
			test.background
				.runs()
				.filter(({ task }) => task === "chosen")
				.map(({ plannedAt }) => plannedAt),
		).toEqual([at("2026-01-01T04:00:00Z"), at("2026-01-02T04:00:00Z")]);
	});

	it("keeps and ignores the row of a task the code no longer declares", async () => {
		{
			await using test = open(at("2026-01-01T00:00:00Z"), [daily("retired", "02:30")]);
			test.background.pause("retired");
		}

		await using test = open(at("2026-01-03T00:00:00Z"), []);
		await test.background.settled();

		expect(test.background.runs().filter(({ task }) => task === "retired")).toEqual([]);
		expect(stateOf(test, "retired")).toEqual(expect.objectContaining({ paused: true }));
		expect(() => test.background.resume("retired")).toThrow(/no scheduled task/);
	});
});

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

		it("runs once, the most recent run, after days with the platform closed, and the next from then on", async () => {
			await using test = createTestPlatform({ modules: [], tasks: [nightly] });
			test.background.start();

			test.clock.set(at("2026-01-05T12:00:00Z"));
			await test.background.settled();
			test.clock.set(at("2026-01-06T01:30:00Z"));
			await test.background.settled();

			expect(planned(test)).toEqual([
				{ plannedDate: "2026-01-05", plannedAt: at("2026-01-05T01:30:00Z"), result: "ok" },
				{ plannedDate: "2026-01-06", plannedAt: at("2026-01-06T01:30:00Z"), result: "ok" },
			]);
		});

		it("creates no run while paused, and after resuming runs next from then on, without what it skipped", async () => {
			await using test = createTestPlatform({ modules: [], tasks: [nightly] });
			test.background.start();
			test.background.pause("nightly");

			test.clock.set(at("2026-01-03T12:00:00Z"));
			await test.background.settled();
			expect(planned(test)).toEqual([]);

			test.background.resume("nightly");
			await test.background.runDue();
			expect(planned(test)).toEqual([]);

			test.clock.set(at("2026-01-04T01:30:00Z"));
			await test.background.settled();
			expect(planned(test)).toEqual([
				{ plannedDate: "2026-01-04", plannedAt: at("2026-01-04T01:30:00Z"), result: "ok" },
			]);
		});
	});

	it("creates no run while the task has one in progress, and records that planned date as skipped", async () => {
		let started!: () => void;
		const running = new Promise<void>((resolve) => (started = resolve));
		let release!: () => void;
		const released = new Promise<void>((resolve) => (release = resolve));
		let jobs = 0;
		await using test = createTestPlatform({
			modules: [],
			tasks: [
				{
					id: "held",
					frequency: { every: "day", at: "02:00" },
					job: {
						lane: "maintenance",
						run: async () => {
							jobs++;
							started();
							await released;
						},
					},
				},
			],
		});
		test.background.start();
		test.clock.set(at("2026-01-01T01:00:00Z"));
		await running;

		test.clock.set(at("2026-01-02T01:00:00Z"));
		release();
		await test.background.settled();

		expect(jobs).toBe(1);
		expect(
			test.background
				.runs()
				.filter((run) => run.task === "held")
				.map(({ plannedDate, result }) => ({ plannedDate, result })),
		).toEqual([
			{ plannedDate: "2026-01-01", result: "ok" },
			{ plannedDate: "2026-01-02", result: "skipped" },
		]);
	});

	describe("with a task of the test, every Sunday at 02:30", () => {
		const weekly = {
			id: "weekly",
			frequency: { every: "week", on: "sunday", at: "02:30" },
			job: { lane: "maintenance", run: () => {} },
		} as const;
		const planned = (test: TestPlatform) =>
			test.background
				.runs()
				.filter((run) => run.task === "weekly")
				.map(({ plannedDate, plannedAt, result }) => ({ plannedDate, plannedAt, result }));

		it("runs only that day, at that time", async () => {
			await using test = createTestPlatform({ modules: [], tasks: [weekly] });
			// Thursday 1 January 2026.
			test.background.start();

			for (const day of [
				"2026-01-02",
				"2026-01-03",
				"2026-01-04",
				"2026-01-05",
				"2026-01-11",
			]) {
				test.clock.set(at(`${day}T12:00:00Z`));
				await test.background.settled();
			}

			expect(planned(test)).toEqual([
				{ plannedDate: "2026-01-04", plannedAt: at("2026-01-04T01:30:00Z"), result: "ok" },
				{ plannedDate: "2026-01-11", plannedAt: at("2026-01-11T01:30:00Z"), result: "ok" },
			]);
		});

		it("runs at 03:00 the last Sunday of March, when 02:30 does not exist", async () => {
			await using test = createTestPlatform({ modules: [], tasks: [weekly] });
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
			await using test = createTestPlatform({ modules: [], tasks: [weekly] });
			test.clock.set(at("2026-10-24T12:00:00Z"));
			test.background.start();

			for (const instant of [
				"2026-10-25T00:30:00Z",
				"2026-10-25T01:30:00Z",
				"2026-10-31T12:00:00Z",
			]) {
				test.clock.set(at(instant));
				await test.background.settled();
			}

			expect(planned(test)).toEqual([
				{ plannedDate: "2026-10-25", plannedAt: at("2026-10-25T00:30:00Z"), result: "ok" },
			]);
		});
	});
});

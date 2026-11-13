// Internal tests of the engine, for what cannot be provoked from outside the platform: a process that ended in
// the middle of a job, two claims of the same job, and a job kind's `failed` rolled back with the job's end.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { connectionOf, openPlatform } from "../platform";
import { createEngine, PermanentJobError, readJobs } from "./engine";
import { readTaskRuns } from "./scheduler";
import { controlledTimer } from "./timer";

const NOW = Date.parse("2026-01-01T00:00:00Z");
const clock = () => NOW;

/** A database file in a folder of its own, removed on dispose. */
function databaseFile() {
	const folder = mkdtempSync(join(tmpdir(), "domus-engine-"));
	return {
		path: join(folder, "domus.db"),
		[Symbol.dispose]: () => rmSync(folder, { recursive: true, force: true }),
	};
}

describe("the engine", () => {
	it("recovers, on the next start over the same database, what a process left running or stuck", () => {
		using file = databaseFile();
		const before = openPlatform(
			{ databaseFile: file.path, modules: [] },
			{ clock, timer: controlledTimer(clock) },
		);
		const insertRun = connectionOf(before).prepare(
			"INSERT INTO platform_task_runs (task, planned_date, planned_at) VALUES ('cleanup', ?, ?)",
		);
		const lastRun = Number(insertRun.run("2025-12-31", NOW).lastInsertRowid);
		const insertJob = connectionOf(before).prepare(
			`INSERT INTO platform_jobs (kind, lane, state, attempts, run_at, task_run, created_at, started_at)
				VALUES (?, 'maintenance', ?, ?, 0, ?, 0, ?)`,
		);
		insertJob.run("parked", "running", 2, null, NOW - 1000);
		insertJob.run("parked", "stuck", 1, null, NOW - 1000);
		insertJob.run("cleanup", "running", 5, lastRun, NOW - 1000);
		// Ended without stopping the background: nothing marks the jobs.
		before.close();

		const after = openPlatform(
			{ databaseFile: file.path, modules: [] },
			{ clock, timer: controlledTimer(clock) },
		);
		const engine = createEngine({
			connection: connectionOf(after),
			clock,
			timer: controlledTimer(clock),
			kinds: new Map([["parked", { lane: "maintenance", run: () => {} }]]),
			onFinish: () => {},
		});
		expect(engine.recover()).toBe(3);

		const interrupted = "interrupted: the process ended while the job ran";
		expect(readJobs(connectionOf(after))).toEqual([
			expect.objectContaining({
				state: "pending",
				attempts: 2,
				runAt: NOW,
				error: interrupted,
			}),
			expect.objectContaining({
				state: "pending",
				attempts: 1,
				runAt: NOW,
				error: interrupted,
			}),
			expect.objectContaining({ state: "failed", attempts: 5, error: interrupted }),
		]);
		expect(engine.recover()).toBe(0);
		after.close();
	});

	it("rolls back a job kind's failed, with the job's end, when what follows in that transaction fails", async () => {
		using file = databaseFile();
		const platform = openPlatform(
			{ databaseFile: file.path, modules: [] },
			{ clock, timer: controlledTimer(clock) },
		);
		const connection = connectionOf(platform);
		connection.exec("CREATE TABLE test_failed_marks (at INTEGER NOT NULL)");
		const markFailed = connection.prepare("INSERT INTO test_failed_marks (at) VALUES (?)");
		const engine = createEngine({
			connection,
			clock,
			timer: controlledTimer(clock),
			kinds: new Map([
				[
					"doomed",
					{
						lane: "maintenance",
						run: () => {
							throw new PermanentJobError("doomed from the start");
						},
						failed: (at: number) => markFailed.run(at),
					},
				],
			]),
			onFinish: () => {
				throw new Error("the run's end could not be recorded");
			},
		});

		engine.enqueue({ kind: "doomed", runAt: NOW });
		engine.pump();
		await expect(Promise.all(engine.inFlight())).rejects.toThrow(
			"the run's end could not be recorded",
		);

		expect(connection.prepare("SELECT at FROM test_failed_marks").all()).toEqual([]);
		expect(readJobs(connection)).toEqual([
			expect.objectContaining({ kind: "doomed", state: "running", attempts: 1 }),
		]);
		platform.close();
	});

	it("recovers at the start of the background, and the run of a job out of attempts ends failed", async () => {
		using file = databaseFile();
		const before = openPlatform({ databaseFile: file.path, modules: [] }, { clock });
		const connection = connectionOf(before);
		const run = Number(
			connection
				.prepare(
					"INSERT INTO platform_task_runs (task, planned_date, planned_at) VALUES ('cleanup', '2025-12-31', ?)",
				)
				.run(NOW - 1000).lastInsertRowid,
		);
		connection
			.prepare(
				`INSERT INTO platform_jobs (kind, lane, state, attempts, run_at, task_run, created_at, started_at)
					VALUES ('cleanup', 'maintenance', 'running', 5, 0, ?, 0, ?)`,
			)
			.run(run, NOW - 1000);
		before.close();

		const timer = controlledTimer(clock);
		const after = openPlatform({ databaseFile: file.path, modules: [] }, { clock, timer });
		expect(after.startBackground()).toEqual({ recovered: 1 });
		expect(readTaskRuns(connectionOf(after))).toEqual([
			expect.objectContaining({
				task: "cleanup",
				startedAt: NOW - 1000,
				finishedAt: NOW,
				result: "failed",
				error: "interrupted: the process ended while the job ran",
			}),
		]);
		await after.stopBackground();
		after.close();
	});

	it("lets only one of two claims of the same job take it", async () => {
		const platform = openPlatform({ databaseFile: ":memory:", modules: [] }, { clock });
		const connection = connectionOf(platform);
		let runs = 0;
		const kinds = new Map([["once", { lane: "short" as const, run: () => void runs++ }]]);
		const engines = [1, 2].map(() =>
			createEngine({ connection, clock, timer: controlledTimer(clock), kinds }),
		);
		const [first, second] = engines;
		first?.enqueue({ kind: "once", runAt: NOW });

		first?.pump();
		second?.pump();
		await Promise.all(engines.flatMap((engine) => engine.inFlight()));

		expect(runs).toBe(1);
		expect(readJobs(connection)).toEqual([
			expect.objectContaining({ state: "done", attempts: 1 }),
		]);
		platform.close();
	});
});

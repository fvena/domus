// Internal tests of the scheduler, for what cannot be provoked from outside the platform.
import { describe, expect, it } from "vitest";

import { connectionOf, openPlatform } from "../platform";
import { createScheduler, readTaskRuns, type ScheduledTask } from "./scheduler";

const at = (iso: string) => Date.parse(iso);

const nightly: ScheduledTask = {
	id: "nightly",
	frequency: { every: "day", at: "02:30" },
	job: { lane: "maintenance", run: () => {} },
};

/** A platform on a clock the test moves, and the scheduler of `nightly` on its connection. */
function withScheduler(enqueue: () => number) {
	let now = at("2026-01-01T00:00:00Z");
	const clock = () => now;
	const platform = openPlatform({ databaseFile: ":memory:", modules: [] }, { clock });
	const connection = connectionOf(platform);
	const scheduler = createScheduler({ connection, clock, tasks: [nightly], enqueue });
	const nextAt = () =>
		connection.prepare("SELECT next_at FROM platform_tasks WHERE id = 'nightly'").pluck().get();
	const jobs = () => connection.prepare("SELECT count(*) FROM platform_jobs").pluck().get();
	return {
		platform,
		connection,
		scheduler,
		nextAt,
		jobs,
		set: (instant: number) => {
			now = instant;
		},
		[Symbol.dispose]: () => platform.close(),
	};
}

describe("the scheduler", () => {
	it("leaves neither the next run moved nor the run recorded when enqueuing its job fails", () => {
		using test = withScheduler(() => {
			throw new Error("the job could not be stored");
		});
		test.scheduler.sync();
		const before = test.nextAt();
		expect(before).toBe(at("2026-01-01T01:30:00Z"));

		test.set(at("2026-01-01T01:30:00Z"));
		expect(() => test.scheduler.enqueueDue()).toThrow("the job could not be stored");

		expect(test.nextAt()).toBe(before);
		expect(readTaskRuns(test.connection)).toEqual([]);
		expect(test.jobs()).toBe(0);
	});

	it("never creates the same planned run twice", () => {
		let enqueued = 0;
		using test = withScheduler(() => ++enqueued);
		test.scheduler.sync();
		test.set(at("2026-01-01T01:30:00Z"));
		test.scheduler.enqueueDue();

		// The task's next run back on the planned instant it already ran, as a clock moved back could leave it.
		test.connection
			.prepare("UPDATE platform_tasks SET next_at = ? WHERE id = 'nightly'")
			.run(at("2026-01-01T01:30:00Z"));
		test.scheduler.enqueueDue();

		expect(readTaskRuns(test.connection).map(({ plannedDate }) => plannedDate)).toEqual([
			"2026-01-01",
		]);
		expect(enqueued).toBe(1);
		expect(() =>
			test.connection
				.prepare(
					"INSERT INTO platform_task_runs (task, planned_date, planned_at) VALUES ('nightly', '2026-01-01', 0)",
				)
				.run(),
		).toThrow(/UNIQUE/);
	});
});

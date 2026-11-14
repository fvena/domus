// Internal tests of the cleanup, for what cannot be seen from outside the platform: which rows of proofs, jobs and
// runs it removes, and its batches, cut halfway by the signal and finished by the next run.
import { describe, expect, it } from "vitest";

import { connectionOf, openPlatform } from "../platform";
import { cleanupTask } from "./cleanup";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-03-01T03:30:00Z");

/** A platform on a fixed clock, with Ana's account, and the cleanup on its connection in batches of `batchSize`. */
function withCleanup(batchSize?: number) {
	const clock = () => NOW;
	const platform = openPlatform({ databaseFile: ":memory:", modules: [] }, { clock });
	const connection = connectionOf(platform);
	connection
		.prepare(
			`INSERT INTO platform_user (id, name, email, created_at, updated_at)
				VALUES ('ana', 'Ana', 'ana@domus.test', 0, 0)`,
		)
		.run();
	const { job } = cleanupTask(connection, clock, batchSize === undefined ? {} : { batchSize });
	const all = (table: string) =>
		connection.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all() as Record<
			string,
			unknown
		>[];
	return {
		connection,
		all,
		/** Every row the cleanup may touch, to compare. */
		snapshot: () =>
			[
				"platform_confirmations",
				"platform_proofs",
				"platform_jobs",
				"platform_task_runs",
			].map(all),
		run: (signal = new AbortController().signal) =>
			job.run({ id: 1, signal, startedAt: NOW, payload: undefined }),
		[Symbol.dispose]: () => platform.close(),
	};
}

describe("the cleanup", () => {
	it("removes the proofs that ended and the unused ones past their expiry, and keeps the used and the current", async () => {
		using test = withCleanup();
		const insert = test.connection.prepare(
			`INSERT INTO platform_proofs (hash, account, origin_session, bound, device, fingerprint, created_at,
				expires_at, state) VALUES (?, 'ana', 's1', 0, 'd1', 'f', 0, ?, ?)`,
		);
		insert.run("ended", NOW + DAY, "ended");
		insert.run("expired", NOW, "issued");
		insert.run("used", NOW - DAY, "used");
		insert.run("current", NOW + 1, "issued");

		await test.run();

		expect(test.all("platform_proofs").map((row) => row["hash"])).toEqual(["used", "current"]);
	});

	it("purges the jobs ended more than 30 days ago and the runs ended more than 90 days ago", async () => {
		using test = withCleanup();
		const run = test.connection.prepare(
			`INSERT INTO platform_task_runs (task, planned_date, planned_at, finished_at, result)
				VALUES ('cleanup', ?, 0, ?, ?)`,
		);
		const old = Number(run.run("2025-11-30", NOW - 91 * DAY, "ok").lastInsertRowid);
		run.run("2025-12-02", NOW - 89 * DAY, "skipped");
		run.run("2025-11-29", null, null);
		const job = test.connection.prepare(
			`INSERT INTO platform_jobs (kind, lane, state, run_at, task_run, created_at, finished_at)
				VALUES (?, 'maintenance', ?, 0, ?, 0, ?)`,
		);
		job.run("done-old", "done", old, NOW - 31 * DAY);
		job.run("failed-old", "failed", null, NOW - 31 * DAY);
		job.run("cancelled-old", "cancelled", null, NOW - 30 * DAY);
		job.run("done-recent", "done", null, NOW - 29 * DAY);
		job.run("pending", "pending", null, null);

		await test.run();

		expect(test.all("platform_jobs").map((row) => row["kind"])).toEqual([
			"done-recent",
			"pending",
		]);
		expect(test.all("platform_task_runs").map((row) => row["planned_date"])).toEqual([
			"2025-12-02",
			"2025-11-29",
		]);
	});

	it("leaves every batch whole when its signal cuts it halfway, the next run finishes, and a third changes nothing", async () => {
		using test = withCleanup(2);
		const insert = test.connection.prepare(
			`INSERT INTO platform_confirmations (id, account, kind, operation, fingerprint, origin, bound, created_at,
				window_closes_at, expires_at, state) VALUES (?, 'ana', 'write', '{"undo":1}', 'f', '{}', 0, 0, 0, ?, 'consumed')`,
		);
		for (const id of ["a", "b", "c", "d", "e"]) insert.run(id, NOW);
		insert.run("current", NOW + 1);
		const emptied = () =>
			test.all("platform_confirmations").filter((row) => row["operation"] === null).length;

		const cut = new AbortController();
		const running = test.run(cut.signal);
		cut.abort();
		await expect(running).rejects.toThrow();
		expect(emptied()).toBe(2);

		await test.run();
		expect(emptied()).toBe(5);
		const done = test.snapshot();

		await test.run();
		expect(test.snapshot()).toEqual(done);
	});
});

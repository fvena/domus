// The nightly backup (ADR 0026) with the real restic: createTestPlatform on a file, with a temporary repository and
// password file, run by the test's clock. Fake restic executables, shell scripts that hand what they do not fake to
// the real one, give the exit codes and the stubborn process the real one gives only by chance. What a test checks
// is what restic lists, what the log of runs and the jobs say and what `/health` answers.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
	chmodSync,
	closeSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	openSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
	writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";

import { defineModule } from "@domus/module-sdk";
import { describe, expect, it, vi } from "vitest";

import { createTestPlatform, TEST_ORIGIN, type TestPlatform } from "./platform";

/** 05:00 in Madrid on the first day of the test clock, when the first backup is due. */
const FIRST_BACKUP = Date.parse("2026-01-01T04:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
/** restic derives its key on every open of the repository, which takes about a second each time. */
const RESTIC_TIMEOUT = 30_000;

/**
 * A module whose migration fills a table with a few hundred pages of rows: the last pages of a fresh database are
 * its own, and opening the platform never reads them.
 */
const bulk = defineModule({
	id: "bulk",
	schema: {},
	migrations: [
		{
			tag: "0000_bulk",
			position: 0,
			hash: "hash-of-0000_bulk",
			statements: [
				"CREATE TABLE `bulk_rows` (`id` integer PRIMARY KEY, `body` text NOT NULL);",
				`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 400)
					INSERT INTO bulk_rows (body) SELECT hex(randomblob(1000)) FROM n;`,
			],
		},
	],
});

/** A module whose migration fills about 10 MB: `db.backup()` copies it in a few dozen steps. */
const large = defineModule({
	id: "large",
	schema: {},
	migrations: [
		{
			tag: "0000_large",
			position: 0,
			hash: "hash-of-0000_large",
			statements: [
				"CREATE TABLE `large_rows` (`id` integer PRIMARY KEY, `body` text NOT NULL);",
				`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 5000)
					INSERT INTO large_rows (body) SELECT hex(randomblob(1000)) FROM n;`,
			],
		},
	],
});

/** The maintenance lane's maximum time, the backup's. */
const MAINTENANCE_TIMEOUT = 30 * 60 * 1000;
/** How long a child process has after SIGTERM before SIGKILL. */
const KILL_GRACE = 5000;

/** SQLite's default page size, the one the platform uses. */
const PAGE_SIZE = 4096;

/** Overwrites the last page of a closed database with garbage: `quick_check` no longer passes. */
function corruptLastPage(databaseFile: string): void {
	const { size } = statSync(databaseFile);
	const handle = openSync(databaseFile, "r+");
	try {
		writeSync(handle, Buffer.alloc(PAGE_SIZE, 0xff), 0, PAGE_SIZE, size - PAGE_SIZE);
	} finally {
		closeSync(handle);
	}
}

/** A temporary repository folder, empty, and a password file, removed at the end of a `using` block. */
function backupTarget() {
	const dir = mkdtempSync(join(tmpdir(), "domus-backups-"));
	const repository = join(dir, "repository");
	mkdirSync(repository);
	const passwordFile = join(dir, "password");
	writeFileSync(passwordFile, randomBytes(24).toString("hex"), { mode: 0o600 });
	return {
		repository,
		passwordFile,
		[Symbol.dispose]: () => rmSync(dir, { recursive: true, force: true }),
	};
}
type BackupTarget = ReturnType<typeof backupTarget>;

/** Runs the real restic on the target and parses its JSON output. */
function restic(target: BackupTarget, ...args: string[]): unknown[] {
	const output = execFileSync("restic", [...args, "--no-cache", "--json"], {
		env: {
			PATH: process.env.PATH,
			RESTIC_REPOSITORY: target.repository,
			RESTIC_PASSWORD_FILE: target.passwordFile,
		},
		encoding: "utf8",
	});
	return output
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line) as unknown);
}

/** The snapshots restic lists in the repository. */
function snapshots(target: BackupTarget) {
	const [list] = restic(target, "snapshots") as [
		{ id: string; hostname: string; time: string }[],
	];
	return list;
}

/**
 * A fake restic: a shell script that answers the subcommands of `cases`, a `case` body each, and hands any other,
 * or a body that falls through, to the real restic. `cases` gets the paths of the fake's own folder, for the flags
 * and signs a body shares with its test. It notes each subcommand it gets in its call log, in order.
 */
function fakeRestic(cases: (path: (name: string) => string) => Readonly<Record<string, string>>) {
	const dir = mkdtempSync(join(tmpdir(), "domus-fake-restic-"));
	const path = (name: string) => join(dir, name);
	const executable = path("restic");
	const log = path("calls");
	const branches = Object.entries(cases(path))
		.map(([command, body]) => `\t${command})\n\t\t${body}\n\t\t;;`)
		.join("\n");
	writeFileSync(
		executable,
		`#!/bin/sh\necho "$1" >> '${log}'\ncase "$1" in\n${branches}\nesac\nexec restic "$@"\n`,
	);
	chmodSync(executable, 0o755);
	return {
		executable,
		path,
		/** The subcommands the fake got, in order. */
		calls: (): string[] =>
			existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : [],
		[Symbol.dispose]: () => rmSync(dir, { recursive: true, force: true }),
	};
}

/** True while the process `pid` exists. */
function isAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

/** The job of the backup task. */
const backupJob = (test: TestPlatform) =>
	test.background.jobs().find((job) => job.kind === "backup");

/** The runs of the backup task, oldest first. */
const backupRuns = (test: TestPlatform) =>
	test.background.runs().filter((run) => run.task === "backup");

/** What `/health` answers over the door. */
async function health(test: TestPlatform): Promise<unknown> {
	const response = await test.door.fetch(new Request(`${TEST_ORIGIN}/health`));
	return response.json();
}

/** Every file under the data folder besides the live database's own, top-level `domus.*`. */
function leftovers(test: TestPlatform): string[] {
	const dataDir = dirname(test.databaseFile);
	return readdirSync(dataDir, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile())
		.map((entry) => relative(dataDir, join(entry.parentPath, entry.name)))
		.filter((path) => !/^domus\.[^/]*$/.test(path));
}

describe("the nightly backup", { timeout: RESTIC_TIMEOUT }, () => {
	it("runs at 05:00 in Madrid and saves a snapshot of host domus at its capture instant", async () => {
		using target = backupTarget();
		await using test = createTestPlatform({ modules: [], file: true, backups: target });
		test.background.start();

		test.clock.set(FIRST_BACKUP);
		await test.background.settled();

		expect(backupRuns(test)).toEqual([
			expect.objectContaining({ result: "ok", error: null, plannedAt: FIRST_BACKUP }),
		]);
		expect(snapshots(target)).toEqual([
			expect.objectContaining({ hostname: "domus", time: "2026-01-01T04:00:00Z" }),
		]);
	});

	it("initializes an empty destination on the first backup, and adds to it on the next", async () => {
		using target = backupTarget();
		await using test = createTestPlatform({ modules: [], file: true, backups: target });
		test.background.start();

		test.clock.set(FIRST_BACKUP);
		await test.background.settled();
		test.clock.set(FIRST_BACKUP + DAY);
		await test.background.settled();

		expect(backupRuns(test).map((run) => run.result)).toEqual(["ok", "ok"]);
		expect(snapshots(target).map((snapshot) => snapshot.time)).toEqual([
			"2026-01-01T04:00:00Z",
			"2026-01-02T04:00:00Z",
		]);
	});

	it("saves nothing of a snapshot that fails quick_check, and fails at once", async () => {
		using target = backupTarget();
		const dir = mkdtempSync(join(tmpdir(), "domus-backups-data-"));
		try {
			const databaseFile = join(dir, "domus.db");
			createTestPlatform({ modules: [bulk], file: databaseFile }).close();
			corruptLastPage(databaseFile);

			await using test = createTestPlatform({
				modules: [bulk],
				file: databaseFile,
				backups: target,
			});
			test.background.start();
			test.clock.set(FIRST_BACKUP);
			await test.background.settled();

			expect(backupRuns(test)).toEqual([
				expect.objectContaining({
					result: "failed",
					error: "PermanentJobError: the snapshot failed quick_check",
				}),
			]);
			expect(test.background.jobs().find((job) => job.kind === "backup")).toEqual(
				expect.objectContaining({ state: "failed", attempts: 1 }),
			);
			expect(readdirSync(target.repository)).toEqual([]);
			expect(leftovers(test)).toEqual([]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it(
		"keeps 7 daily, 4 weekly and 3 monthly snapshots of host domus after a saved backup",
		{ timeout: 4 * RESTIC_TIMEOUT },
		async () => {
			using target = backupTarget();
			restic(target, "init");
			// Snapshots of earlier days, before the backup of 2026-01-01; weeks start on Monday, 2025-12-29 among them.
			const earlier = [
				"2025-09-30",
				"2025-10-31",
				"2025-11-15",
				"2025-11-29",
				"2025-12-06",
				"2025-12-13",
				"2025-12-20",
				"2025-12-24",
				"2025-12-25",
				"2025-12-26",
				"2025-12-27",
				"2025-12-28",
				"2025-12-29",
				"2025-12-30",
				"2025-12-31",
			];
			const source = join(dirname(target.repository), "source");
			writeFileSync(source, "an earlier day");
			for (const day of earlier)
				restic(target, "backup", "--host", "domus", "--time", `${day} 04:00:00`, source);
			await using test = createTestPlatform({ modules: [], file: true, backups: target });
			test.background.start();

			test.clock.set(FIRST_BACKUP);
			await test.background.settled();

			expect(backupRuns(test).map((run) => run.result)).toEqual(["ok"]);
			expect(snapshots(target).map((snapshot) => snapshot.time.slice(0, 10))).toEqual([
				// Monthly: November's last; weekly: the last of the weeks of 13 and 20 December.
				"2025-11-29",
				"2025-12-13",
				"2025-12-20",
				// Daily: the last seven days; weekly and monthly count these too.
				"2025-12-26",
				"2025-12-27",
				"2025-12-28",
				"2025-12-29",
				"2025-12-30",
				"2025-12-31",
				"2026-01-01",
			]);
		},
	);

	it("saves only the database, at the root of the snapshot, and leaves the staging folder empty", async () => {
		using target = backupTarget();
		await using test = createTestPlatform({ modules: [], file: true, backups: target });
		test.background.start();

		test.clock.set(FIRST_BACKUP);
		await test.background.settled();

		const files = restic(target, "ls", "latest").filter(
			(line) => (line as { struct_type?: string }).struct_type === "node",
		);
		expect(files).toEqual([expect.objectContaining({ path: "/domus.db", type: "file" })]);
		expect(leftovers(test)).toEqual([]);
	});
});

describe("a backup that goes wrong", { timeout: RESTIC_TIMEOUT }, () => {
	it("does not count a partial snapshot (code 3): it fails at once, without retention, and /health says stale", async () => {
		using target = backupTarget();
		using fake = fakeRestic(() => ({ backup: "exit 3" }));
		await using test = createTestPlatform({
			modules: [],
			file: true,
			backups: { ...target, restic: fake.executable },
		});
		test.background.start();

		test.clock.set(FIRST_BACKUP);
		await test.background.settled();

		expect(backupRuns(test)).toEqual([
			expect.objectContaining({
				result: "failed",
				error: "PermanentJobError: restic backup exited with code 3",
			}),
		]);
		expect(test.background.jobs().find((job) => job.kind === "backup")).toEqual(
			expect.objectContaining({ state: "failed", attempts: 1 }),
		);
		expect(fake.calls()).not.toContain("forget");
		expect(await health(test)).toEqual({
			status: "ok",
			background: { status: "degraded", reasons: ["backup-stale"], backups: "none" },
		});
		expect(leftovers(test)).toEqual([]);
	});
});

describe("a destination that does not open", { timeout: 2 * RESTIC_TIMEOUT }, () => {
	/** Runs the first backup on `backups` and returns its one job. */
	async function firstBackup(backups: { repository: string; passwordFile: string }) {
		await using test = createTestPlatform({ modules: [], file: true, backups });
		test.background.start();
		test.clock.set(FIRST_BACKUP);
		await test.background.settled();
		return {
			runs: backupRuns(test),
			job: test.background.jobs().find((job) => job.kind === "backup"),
		};
	}

	it("fails at once, never initializing a destination with something in it", async () => {
		using target = backupTarget();
		writeFileSync(join(target.repository, "notes.txt"), "not a repository");

		const { runs, job } = await firstBackup(target);

		expect(runs).toEqual([
			expect.objectContaining({
				result: "failed",
				error: "PermanentJobError: restic backup exited with code 10",
			}),
		]);
		expect(job).toEqual(expect.objectContaining({ state: "failed", attempts: 1 }));
		expect(readdirSync(target.repository)).toEqual(["notes.txt"]);
	});

	it("fails at once, creating nothing, when the destination is missing", async () => {
		using target = backupTarget();
		const repository = join(target.repository, "missing");

		const { runs, job } = await firstBackup({ ...target, repository });

		expect(runs).toEqual([
			expect.objectContaining({
				result: "failed",
				error: "PermanentJobError: restic backup exited with code 10",
			}),
		]);
		expect(job).toEqual(expect.objectContaining({ state: "failed", attempts: 1 }));
		expect(existsSync(repository)).toBe(false);
	});

	it("fails at once with a wrong password, and the repository keeps its snapshots", async () => {
		using target = backupTarget();
		restic(target, "init");
		const wrong = join(dirname(target.passwordFile), "wrong-password");
		writeFileSync(wrong, "not the password", { mode: 0o600 });

		const { runs, job } = await firstBackup({ ...target, passwordFile: wrong });

		expect(runs).toEqual([
			expect.objectContaining({
				result: "failed",
				error: "PermanentJobError: restic unlock exited with code 12",
			}),
		]);
		expect(job).toEqual(expect.objectContaining({ state: "failed", attempts: 1 }));
		expect(snapshots(target)).toEqual([]);
	});
});

describe("a repository locked by another process", { timeout: RESTIC_TIMEOUT }, () => {
	it("retries the backup, and saves it once the lock is gone", async () => {
		using target = backupTarget();
		using fake = fakeRestic((path) => ({ backup: `[ -e '${path("locked")}' ] && exit 11` }));
		writeFileSync(fake.path("locked"), "");
		await using test = createTestPlatform({
			modules: [],
			file: true,
			backups: { ...target, restic: fake.executable },
		});
		test.background.start();

		test.clock.set(FIRST_BACKUP);
		await test.background.settled();

		expect(test.background.jobs().find((job) => job.kind === "backup")).toEqual(
			expect.objectContaining({
				state: "pending",
				attempts: 1,
				error: "ResticLockedError backup-11",
			}),
		);
		expect(backupRuns(test)).toEqual([expect.objectContaining({ result: null })]);

		rmSync(fake.path("locked"));
		test.clock.advance(30 * 1000);
		await test.background.settled();

		expect(backupRuns(test)).toEqual([expect.objectContaining({ result: "ok" })]);
		expect(snapshots(target)).toHaveLength(1);
	});
});

describe("a backup past its maximum time", { timeout: RESTIC_TIMEOUT }, () => {
	it("kills a restic that ignores SIGTERM, and frees the lane only once it ended", async () => {
		using target = backupTarget();
		using fake = fakeRestic((path) => ({
			// It ignores SIGTERM, then tells the test its pid; `sleep` holds no pipe of restic's.
			backup: `trap '' TERM; echo $$ > '${path("pid.tmp")}'; mv '${path("pid.tmp")}' '${path("pid")}'; while :; do sleep 0.05 > /dev/null 2>&1; done`,
		}));
		await using test = createTestPlatform({
			modules: [],
			file: true,
			backups: { ...target, restic: fake.executable },
		});
		// What a crash in the middle of a backup left in the staging folder.
		const staging = join(dirname(test.databaseFile), "backup-staging");
		mkdirSync(staging);
		writeFileSync(join(staging, "domus.db"), "a snapshot a crash left behind");
		writeFileSync(join(staging, "left-behind"), "");
		test.background.start();

		test.clock.set(FIRST_BACKUP);
		await vi.waitFor(() => expect(existsSync(fake.path("pid"))).toBe(true), {
			timeout: RESTIC_TIMEOUT,
		});
		const pid = Number(readFileSync(fake.path("pid"), "utf8"));
		expect(readdirSync(staging)).not.toContain("left-behind");

		test.clock.advance(MAINTENANCE_TIMEOUT);
		await new Promise((resolve) => setTimeout(resolve, 300));
		expect(isAlive(pid)).toBe(true);
		expect(backupJob(test)).toEqual(expect.objectContaining({ state: "running" }));

		test.clock.advance(KILL_GRACE);
		await test.background.settled();

		expect(isAlive(pid)).toBe(false);
		expect(backupJob(test)).toEqual(
			expect.objectContaining({
				state: "pending",
				attempts: 1,
				error: `timed out after ${MAINTENANCE_TIMEOUT} ms`,
			}),
		);
		expect(leftovers(test)).toEqual([]);
	});

	it("aborts db.backup() while it copies, and leaves the staging folder empty", async () => {
		using target = backupTarget();
		using fake = fakeRestic(() => ({}));
		const dir = mkdtempSync(join(tmpdir(), "domus-backups-data-"));
		try {
			const databaseFile = join(dir, "domus.db");
			await using test = createTestPlatform({
				modules: [large],
				file: databaseFile,
				backups: { ...target, restic: fake.executable },
			});
			test.background.start();

			test.clock.set(FIRST_BACKUP);
			const snapshot = join(dir, "backup-staging", "domus.db");
			while (!existsSync(snapshot)) await new Promise((resolve) => setImmediate(resolve));
			test.clock.advance(MAINTENANCE_TIMEOUT);
			await test.background.settled();

			expect(backupJob(test)).toEqual(
				expect.objectContaining({
					state: "pending",
					attempts: 1,
					error: `timed out after ${MAINTENANCE_TIMEOUT} ms`,
				}),
			);
			expect(fake.calls()).toEqual([]);
			expect(leftovers(test)).toEqual([]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("a failed retention", { timeout: 2 * RESTIC_TIMEOUT }, () => {
	it("keeps the backup saved, fails the run with its own message and reason, and a good one clears it", async () => {
		using target = backupTarget();
		using fake = fakeRestic((path) => ({ forget: `[ -e '${path("failing")}' ] && exit 1` }));
		const failing = fake.path("failing");
		writeFileSync(failing, "");
		await using test = createTestPlatform({
			modules: [],
			file: true,
			backups: { ...target, restic: fake.executable },
		});
		test.background.start();

		test.clock.set(FIRST_BACKUP);
		await test.background.settled();

		expect(backupRuns(test)).toEqual([
			expect.objectContaining({
				result: "failed",
				error: "PermanentJobError: restic forget exited with code 1",
			}),
		]);
		expect(await health(test)).toEqual({
			status: "ok",
			background: {
				status: "degraded",
				reasons: ["backup-retention-failed"],
				backups: "saved",
			},
		});
		// No retry repeats the backup.
		test.clock.advance(60 * 60 * 1000);
		await test.background.settled();
		expect(snapshots(target)).toHaveLength(1);

		rmSync(failing);
		test.clock.set(FIRST_BACKUP + DAY);
		await test.background.settled();

		expect(backupRuns(test).map((run) => run.result)).toEqual(["failed", "ok"]);
		expect(snapshots(target)).toHaveLength(2);
		expect(await health(test)).toEqual({
			status: "ok",
			background: { status: "ok", backups: "saved" },
		});
	});
});

describe("the backups in /health", { timeout: RESTIC_TIMEOUT }, () => {
	it("say none-yet before the first backup and saved after it, without a reason", async () => {
		using target = backupTarget();
		await using test = createTestPlatform({ modules: [], file: true, backups: target });
		test.background.start();
		expect(await health(test)).toEqual({
			status: "ok",
			background: { status: "ok", backups: "none-yet" },
		});

		test.clock.set(FIRST_BACKUP);
		await test.background.settled();

		expect(await health(test)).toEqual({
			status: "ok",
			background: { status: "ok", backups: "saved" },
		});
	});

	it("say stale only once the last saved backup was captured more than 48 h ago", async () => {
		using target = backupTarget();
		await using test = createTestPlatform({ modules: [], file: true, backups: target });
		test.background.start();
		test.clock.set(FIRST_BACKUP);
		await test.background.settled();
		test.background.pause("backup");

		test.clock.set(FIRST_BACKUP + 2 * DAY - 1);
		expect(await health(test)).toEqual({
			status: "ok",
			background: { status: "ok", backups: "saved" },
		});
		test.clock.set(FIRST_BACKUP + 2 * DAY);
		expect(await health(test)).toEqual({
			status: "ok",
			background: { status: "ok", backups: "saved" },
		});
		test.clock.set(FIRST_BACKUP + 2 * DAY + 1);
		expect(await health(test)).toEqual({
			status: "ok",
			background: { status: "degraded", reasons: ["backup-stale"], backups: "saved" },
		});
	});

	it("say saved after closing and opening the platform again", async () => {
		using target = backupTarget();
		const dir = mkdtempSync(join(tmpdir(), "domus-backups-data-"));
		try {
			const databaseFile = join(dir, "domus.db");
			{
				await using test = createTestPlatform({
					modules: [],
					file: databaseFile,
					backups: target,
				});
				test.background.start();
				test.clock.set(FIRST_BACKUP);
				await test.background.settled();
			}

			await using test = createTestPlatform({
				modules: [],
				file: databaseFile,
				backups: target,
			});
			test.background.start();
			expect(await health(test)).toEqual({
				status: "ok",
				background: { status: "ok", backups: "saved" },
			});
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("say off, and no backup task is declared, when the backups are off", async () => {
		await using test = createTestPlatform({ modules: [], file: true });
		test.background.start();
		test.clock.set(FIRST_BACKUP);
		await test.background.settled();

		expect(await health(test)).toEqual({
			status: "ok",
			background: { status: "ok", backups: "off" },
		});
		expect(test.background.tasks().map((task) => task.id)).toEqual(["cleanup"]);
		expect(backupRuns(test)).toEqual([]);
	});

	it("tell nothing of the repository, the snapshot or the accounts", async () => {
		using target = backupTarget();
		await using test = createTestPlatform({ modules: [], file: true, backups: target });
		test.prepare.account({ id: "ana", role: "admin" });
		test.background.start();
		test.clock.set(FIRST_BACKUP);
		await test.background.settled();

		const body = JSON.stringify(await health(test));
		const [snapshot] = snapshots(target);
		expect(body).not.toContain(snapshot?.id.slice(0, 8));
		expect(body).not.toMatch(/ana|@|\/|domus-backups|repository/);
	});
});

/** 05:30 in Madrid on the first Sunday of the test clock, when the first check of the repository is due. */
const FIRST_CHECK = Date.parse("2026-01-04T04:30:00Z");
const WEEK = 7 * DAY;

/** The runs of the check task, oldest first. */
const checkRuns = (test: TestPlatform) =>
	test.background.runs().filter((run) => run.task === "backup-check");

describe("the weekly check of the repository", { timeout: 2 * RESTIC_TIMEOUT }, () => {
	it("runs on Sunday at 05:30 in Madrid and reads the whole repository with restic", async () => {
		using target = backupTarget();
		using fake = fakeRestic(() => ({}));
		await using test = createTestPlatform({
			modules: [],
			file: true,
			backups: { ...target, restic: fake.executable },
		});
		test.background.start();
		test.clock.set(FIRST_BACKUP);
		await test.background.settled();

		test.clock.set(FIRST_CHECK);
		await test.background.settled();

		expect(checkRuns(test)).toEqual([
			expect.objectContaining({ result: "ok", error: null, plannedAt: FIRST_CHECK }),
		]);
		expect(fake.calls().slice(-2)).toEqual(["unlock", "check"]);
		expect(await health(test)).toEqual({
			status: "ok",
			background: { status: "ok", backups: "saved" },
		});
	});

	it("fails on a repository that lost a pack, says so in /health, and a good check clears it", async () => {
		using target = backupTarget();
		await using test = createTestPlatform({ modules: [], file: true, backups: target });
		test.background.start();
		test.clock.set(FIRST_BACKUP);
		await test.background.settled();
		// No new backup touches the damaged repository: from Sunday on, the saved one is stale.
		test.background.pause("backup");
		const [pack] = readdirSync(join(target.repository, "data"), {
			recursive: true,
			withFileTypes: true,
		}).filter((entry) => entry.isFile());
		if (pack === undefined) throw new Error("the repository holds no pack");
		const packFile = join(pack.parentPath, pack.name);
		const aside = join(dirname(target.repository), "pack-aside");
		renameSync(packFile, aside);

		test.clock.set(FIRST_CHECK);
		await test.background.settled();

		expect(checkRuns(test)).toEqual([
			expect.objectContaining({
				result: "failed",
				error: "PermanentJobError: restic check exited with code 1",
			}),
		]);
		expect(await health(test)).toEqual({
			status: "ok",
			background: {
				status: "degraded",
				reasons: ["backup-stale", "backup-check-failed"],
				backups: "saved",
			},
		});

		renameSync(aside, packFile);
		test.clock.set(FIRST_CHECK + WEEK);
		await test.background.settled();

		expect(checkRuns(test).map((run) => run.result)).toEqual(["failed", "ok"]);
		expect(await health(test)).toEqual({
			status: "ok",
			background: { status: "degraded", reasons: ["backup-stale"], backups: "saved" },
		});
	});

	it("ends well without checking while the repository does not exist yet, and its mark stays", async () => {
		using target = backupTarget();
		using fake = fakeRestic((path) => ({ unlock: `[ -e '${path("failing")}' ] && exit 1` }));
		writeFileSync(fake.path("failing"), "");
		await using test = createTestPlatform({
			modules: [],
			file: true,
			backups: { ...target, restic: fake.executable },
		});
		test.background.start();
		test.background.pause("backup");
		test.clock.set(FIRST_CHECK);
		await test.background.settled();
		const failed = {
			status: "ok",
			background: {
				status: "degraded",
				reasons: ["backup-check-failed"],
				backups: "none-yet",
			},
		};
		expect(await health(test)).toEqual(failed);

		rmSync(fake.path("failing"));
		test.clock.set(FIRST_CHECK + WEEK);
		await test.background.settled();

		expect(checkRuns(test).map((run) => run.result)).toEqual(["failed", "ok"]);
		expect(fake.calls()).toEqual(["unlock", "unlock"]);
		expect(readdirSync(target.repository)).toEqual([]);
		expect(await health(test)).toEqual(failed);
	});
});

describe("a check that finds the repository locked", { timeout: RESTIC_TIMEOUT }, () => {
	it("is retried, and counts as a failed check once it used up its attempts", async () => {
		using target = backupTarget();
		restic(target, "init");
		using fake = fakeRestic(() => ({ check: "exit 11" }));
		await using test = createTestPlatform({
			modules: [],
			file: true,
			backups: { ...target, restic: fake.executable },
		});
		test.background.start();
		test.background.pause("backup");
		test.clock.set(FIRST_CHECK);
		await test.background.settled();

		const checkJob = () => test.background.jobs().find((job) => job.kind === "backup-check");
		expect(checkJob()).toEqual(
			expect.objectContaining({
				state: "pending",
				attempts: 1,
				error: "ResticLockedError check-11",
			}),
		);
		expect(await health(test)).toEqual({
			status: "ok",
			background: { status: "ok", backups: "none-yet" },
		});

		// The waits between the five attempts: 30 s, doubling.
		for (const wait of [30, 60, 120, 240]) {
			test.clock.advance(wait * 1000);
			await test.background.settled();
		}

		expect(checkJob()).toEqual(expect.objectContaining({ state: "failed", attempts: 5 }));
		expect(fake.calls().filter((call) => call === "check")).toHaveLength(5);
		expect(checkRuns(test)).toEqual([
			expect.objectContaining({ result: "failed", error: "ResticLockedError check-11" }),
		]);
		expect(await health(test)).toEqual({
			status: "ok",
			background: {
				status: "degraded",
				reasons: ["backup-check-failed"],
				backups: "none-yet",
			},
		});
	});
});

describe("the marks of the backups", { timeout: 2 * RESTIC_TIMEOUT }, () => {
	/** Every reason of the backups at once: the saved backup stale, its retention failed and the check failed. */
	const allReasons = ["backup-stale", "backup-retention-failed", "backup-check-failed"];

	/**
	 * Opens the platform on `databaseFile` with a restic whose retention and check fail, saves the first backup,
	 * pauses it and fails the first check.
	 */
	async function everyBackupReason(
		databaseFile: string,
		backups: { repository: string; passwordFile: string; restic: string },
	): Promise<TestPlatform> {
		const test = createTestPlatform({ modules: [], file: databaseFile, backups });
		test.background.start();
		test.clock.set(FIRST_BACKUP);
		await test.background.settled();
		test.background.pause("backup");
		test.clock.set(FIRST_CHECK);
		await test.background.settled();
		return test;
	}

	/** A data folder of its own, so closing the platform keeps its database. */
	function dataFolder() {
		const dir = mkdtempSync(join(tmpdir(), "domus-backups-data-"));
		return {
			databaseFile: join(dir, "domus.db"),
			[Symbol.dispose]: () => rmSync(dir, { recursive: true, force: true }),
		};
	}

	it("give every reason at once, in their order after the scheduler's, and the same after closing and opening", async () => {
		using target = backupTarget();
		using fake = fakeRestic(() => ({ forget: "exit 1", check: "exit 1" }));
		using data = dataFolder();
		const backups = { ...target, restic: fake.executable };
		{
			await using test = await everyBackupReason(data.databaseFile, backups);
			test.clock.advance(6 * 60 * 1000, { wake: false });

			expect(await health(test)).toEqual({
				status: "ok",
				background: {
					status: "degraded",
					reasons: ["scheduler-silent", ...allReasons],
					backups: "saved",
				},
			});
		}

		await using test = createTestPlatform({ modules: [], file: data.databaseFile, backups });
		test.clock.set(FIRST_CHECK);
		test.background.start();

		expect(await health(test)).toEqual({
			status: "ok",
			background: { status: "degraded", reasons: allReasons, backups: "saved" },
		});
	});

	it("outlive the purge of the runs older than 90 days: a backup paused that long still says saved", async () => {
		using target = backupTarget();
		using fake = fakeRestic(() => ({ forget: "exit 1", check: "exit 1" }));
		using data = dataFolder();
		await using test = await everyBackupReason(data.databaseFile, {
			...target,
			restic: fake.executable,
		});
		test.background.pause("backup-check");
		expect([...backupRuns(test), ...checkRuns(test)]).toHaveLength(2);

		test.clock.set(FIRST_CHECK + 100 * DAY);
		await test.background.settled();

		expect([...backupRuns(test), ...checkRuns(test)]).toEqual([]);
		expect(await health(test)).toEqual({
			status: "ok",
			background: { status: "degraded", reasons: allReasons, backups: "saved" },
		});
	});
});

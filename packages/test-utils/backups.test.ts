// The nightly backup (ADR 0026) with the real restic: createTestPlatform on a file, with a temporary repository and
// password file, run by the test's clock. What a test checks is what restic lists, what the log of runs says and
// what `/health` answers.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
	closeSync,
	mkdirSync,
	mkdtempSync,
	openSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
	writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";

import { defineModule } from "@domus/module-sdk";
import { describe, expect, it } from "vitest";

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

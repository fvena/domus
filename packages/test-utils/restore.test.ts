// Restoring (ADR 0026) as a function of the platform, with the real restic: each test prepares data on a file of
// its own temporary folder, backs it up with the nightly task, closes the platform, restores and opens the same
// file again. What it checks is what the platform shows once open again, what the door answers and what is left
// in the data folder.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineModule, type ModuleMigration } from "@domus/module-sdk";
import { writeAction } from "@domus/module-sdk/contracts";
import { type RestorePoint, startChild } from "@domus/platform/testing";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { TestBrowser } from "./browser";
import {
	createTestPlatform,
	listBackups,
	pendingFrom,
	restoreBackup,
	type SyntheticJob,
	TEST_ORIGIN,
	TEST_START,
	type TestPlatform,
} from "./platform";

/** The marker of a restore that has not ended, in the data folder: its name is part of the procedure. */
const MARKER = "restore.pending";

/** 05:00 in Madrid on the first day of the test clock, when the first backup is due. */
const FIRST_BACKUP = Date.parse("2026-01-01T04:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
/** How long a job goes on past its cancellation before it counts as stuck. */
const STUCK_MARGIN = 10 * 1000;
/** restic derives its key on every open of the repository, which takes about a second each time. */
const RESTIC_TIMEOUT = 60_000;

/** A module whose one write is logged with its value: the action log shows which writes the database holds. */
const ledger = defineModule({
	id: "ledger",
	schema: {},
	migrations: [],
	contract: {
		note: writeAction({ undoable: false, level: "write" })
			.input(z.object({ value: z.number() }))
			.output(z.number()),
	},
	actions: {
		note: ({ input }) => ({ result: input.value, touched: [] }),
	},
});

/**
 * A temporary data folder, a repository folder, empty, and a password file, removed at the end of a `using` block.
 * The database is a file of the data folder, kept across closing and opening.
 */
function restoreTarget() {
	const dir = mkdtempSync(join(tmpdir(), "domus-restore-"));
	const data = join(dir, "data");
	mkdirSync(data);
	const repository = join(dir, "repository");
	mkdirSync(repository);
	const passwordFile = join(dir, "password");
	writeFileSync(passwordFile, randomBytes(24).toString("hex"), { mode: 0o600 });
	return {
		data,
		databaseFile: join(data, "domus.db"),
		backups: { repository, passwordFile },
		[Symbol.dispose]: () => rmSync(dir, { recursive: true, force: true }),
	};
}
type RestoreTarget = ReturnType<typeof restoreTarget>;

/** A platform of `ledger` on the target's file, with the backups on, and the synthetic jobs given. */
function open(
	target: RestoreTarget,
	jobs?: Readonly<Record<string, SyntheticJob>>,
): TestPlatform<readonly [typeof ledger]> {
	return createTestPlatform({
		modules: [ledger],
		file: target.databaseFile,
		backups: target.backups,
		...(jobs === undefined ? {} : { jobs }),
	});
}

/** A synthetic job of the short lane that counts its attempts and ends each when the test lets it, or at once. */
function countedJob({ timeout, held = false }: { timeout?: number; held?: boolean } = {}) {
	let started = 0;
	let release = () => {};
	const job: SyntheticJob = {
		lane: "short",
		...(timeout === undefined ? {} : { timeout }),
		run: () => {
			started += 1;
			return held
				? new Promise<void>((resolve) => {
						release = resolve;
					})
				: undefined;
		},
	};
	return {
		job,
		get started() {
			return started;
		},
		release: () => release(),
	};
}

/** Runs the real restic on the target's repository. */
function restic(target: RestoreTarget, ...args: string[]): string {
	return execFileSync("restic", [...args, "--no-cache"], {
		env: {
			PATH: process.env.PATH,
			RESTIC_REPOSITORY: target.backups.repository,
			RESTIC_PASSWORD_FILE: target.backups.passwordFile,
		},
		encoding: "utf8",
	});
}

/**
 * Runs the nightly backup at `at` on a started platform, and waits until it saved its snapshot: only for it, since
 * another job may be held running.
 */
async function backUp(test: TestPlatform, at = FIRST_BACKUP): Promise<void> {
	test.clock.set(at);
	await vi.waitFor(
		() => {
			const runs = test.background.runs().filter((run) => run.task === "backup");
			expect(runs[runs.length - 1]).toEqual(expect.objectContaining({ result: "ok" }));
		},
		{ timeout: RESTIC_TIMEOUT / 2, interval: 50 },
	);
}

const PASSWORD = "a long enough password";

/** A new browser signed in as `ana`. */
async function signIn(test: TestPlatform): Promise<TestBrowser> {
	const browser = test.browser();
	expect((await browser.signIn("ana@domus.test", PASSWORD)).status).toBe(200);
	return browser;
}

/** Lists the browser's sessions over HTTP: an operation that needs one. */
function listSessions(browser: TestBrowser): Promise<Response> {
	return browser.fetch(new Request(`${TEST_ORIGIN}/api/rpc/sessions/list`, { method: "POST" }));
}

/** The values of the writes of `ledger` the action log holds, in order. */
const notes = (test: TestPlatform) => test.log().map((entry) => entry.input);

/** Notes 1, backs up at {@link FIRST_BACKUP}, notes 2 and closes: the backup holds only the first note. */
async function backedUpThenNoted(target: RestoreTarget): Promise<void> {
	await using test = open(target);
	const ana = test.member("ana");
	test.invoke(ana, "ledger.note", { value: 1 }, { idempotencyKey: "one" });
	test.background.start();
	await backUp(test);
	test.invoke(ana, "ledger.note", { value: 2 }, { idempotencyKey: "two" });
}

/**
 * Notes 1, backs up and closes; then notes 2 and leaves the data folder as a process killed right then would: the
 * second note committed only in the WAL, beside a database that holds the first one.
 */
async function backedUpThenNotedIntoWal(target: RestoreTarget): Promise<void> {
	{
		await using test = open(target);
		test.invoke(test.member("ana"), "ledger.note", { value: 1 }, { idempotencyKey: "one" });
		test.background.start();
		await backUp(test);
	}
	const crashed = join(target.data, "..", "crashed");
	mkdirSync(crashed);
	{
		await using test = open(target);
		test.invoke(test.member("ana"), "ledger.note", { value: 2 }, { idempotencyKey: "two" });
		for (const name of ["domus.db", "domus.db-wal"])
			copyFileSync(join(target.data, name), join(crashed, name));
	}
	// Closing checkpointed the WAL into the database and removed it: put back the files of the moment before.
	for (const name of ["domus.db", "domus.db-wal"])
		copyFileSync(join(crashed, name), join(target.data, name));
	rmSync(crashed, { recursive: true });
}

/** The notes of a database file opened apart, without the backups. */
async function notesOf(file: string): Promise<unknown[]> {
	await using test = createTestPlatform({ modules: [ledger], file });
	return notes(test);
}

/** What the data folder holds as `domus.db`: nothing, an empty file, or a SQLite database with data. */
function databaseIn(target: RestoreTarget): "absent" | "empty" | "sqlite" | "other" {
	let size: number;
	try {
		size = statSync(target.databaseFile).size;
	} catch {
		return "absent";
	}
	if (size === 0) return "empty";
	const header = readFileSync(target.databaseFile).subarray(0, 16).toString("latin1");
	return header === "SQLite format 3\0" ? "sqlite" : "other";
}

/** What `/health` answers over the door. */
async function health(test: TestPlatform): Promise<unknown> {
	const response = await test.door.fetch(new Request(`${TEST_ORIGIN}/health`));
	return response.json();
}

describe("restoring a backup", { timeout: RESTIC_TIMEOUT }, () => {
	it("brings back the data of the backup and not what came after it", async () => {
		using target = restoreTarget();
		{
			await using test = open(target);
			const ana = test.member("ana");
			test.invoke(ana, "ledger.note", { value: 1 }, { idempotencyKey: "one" });
			test.background.start();
			await backUp(test);
			test.invoke(ana, "ledger.note", { value: 2 }, { idempotencyKey: "two" });
		}

		await restoreBackup({
			file: target.databaseFile,
			modules: [ledger],
			backups: target.backups,
		});

		await using test = open(target);
		expect(notes(test)).toEqual([{ value: 1 }]);
		// The key of the later write is lost with it: the same key is a new write.
		expect(
			test.invoke(test.member("ana"), "ledger.note", { value: 2 }, { idempotencyKey: "two" }),
		).toEqual(expect.objectContaining({ result: 2 }));
	});

	it("discards the jobs the backup held pending, running or stuck, while the same state opened without restoring recovers them", async () => {
		using target = restoreTarget();
		{
			// In the backup: `stubborn` stuck on the short lane, `waiting` pending behind it and the backup's own job running.
			const stubborn = countedJob({ timeout: 1000, held: true });
			const waiting = countedJob();
			await using test = open(target, { stubborn: stubborn.job, waiting: waiting.job });
			test.background.start();
			test.background.enqueue("stubborn");
			test.clock.advance(1000);
			test.clock.advance(STUCK_MARGIN);
			test.background.enqueue("waiting");
			expect(test.background.jobs().map(({ kind, state }) => [kind, state])).toEqual([
				["stubborn", "stuck"],
				["waiting", "pending"],
			]);
			await backUp(test);
			stubborn.release();
		}

		// The snapshot as it is, opened in a folder of its own: a normal restart recovers what it holds.
		const unrestored = join(target.data, "..", "unrestored");
		restic(target, "restore", "latest", "--target", unrestored);
		{
			const stubborn = countedJob();
			const waiting = countedJob();
			// Without the backups: the backup's job recovered there must not add a snapshot to the repository.
			await using test = createTestPlatform({
				modules: [ledger],
				file: join(unrestored, "domus.db"),
				jobs: { stubborn: stubborn.job, waiting: waiting.job },
			});
			test.background.start();
			test.clock.set(FIRST_BACKUP);
			await test.background.settled();
			expect([stubborn.started, waiting.started]).toEqual([1, 1]);
		}

		await restoreBackup({
			file: target.databaseFile,
			modules: [ledger],
			backups: target.backups,
			at: FIRST_BACKUP + DAY,
		});

		const stubborn = countedJob();
		const waiting = countedJob();
		await using test = open(target, { stubborn: stubborn.job, waiting: waiting.job });
		test.background.start();
		test.clock.set(FIRST_BACKUP + DAY);
		await test.background.settled();
		expect([stubborn.started, waiting.started]).toEqual([0, 0]);
		const discarded = { state: "cancelled", error: "discarded by restore" };
		// The cleanup of 04:30 ran before the backup, and ended.
		expect(test.background.jobs().filter((job) => job.kind !== "cleanup")).toEqual([
			expect.objectContaining({ kind: "stubborn", ...discarded }),
			expect.objectContaining({ kind: "waiting", ...discarded }),
			expect.objectContaining({ kind: "backup", ...discarded }),
		]);
		expect(test.background.runs().filter((run) => run.task === "backup")).toEqual([
			expect.objectContaining({
				task: "backup",
				result: "cancelled",
				error: "discarded by restore",
			}),
		]);
	});

	it("plans each task's next run from the restore, catching up nothing, and leaves a paused task paused", async () => {
		using target = restoreTarget();
		let paused: unknown;
		{
			await using test = open(target);
			test.background.pause("cleanup");
			paused = test.background.tasks().find((task) => task.id === "cleanup");
			test.background.start();
			await backUp(test);
		}
		const restoredAt = Date.parse("2026-01-05T12:00:00Z");

		await restoreBackup({
			file: target.databaseFile,
			modules: [ledger],
			backups: target.backups,
			at: restoredAt,
		});

		await using test = open(target);
		expect(test.background.tasks()).toEqual([
			// 05:00 in Madrid, the day after the restore.
			{ id: "backup", time: null, paused: false, nextAt: Date.parse("2026-01-06T04:00:00Z") },
			// 05:30 in Madrid, the Sunday after the restore, a Monday.
			{
				id: "backup-check",
				time: null,
				paused: false,
				nextAt: Date.parse("2026-01-11T04:30:00Z"),
			},
			paused,
		]);
		test.background.start();
		test.clock.set(restoredAt);
		await test.background.settled();
		expect(test.background.runs().map((run) => run.result)).toEqual(["cancelled"]);
	});

	it("ends every session: the cookies of a browser signed in before the backup and of one after it no longer serve", async () => {
		using target = restoreTarget();
		const signedIn: TestBrowser[] = [];
		{
			await using test = open(target);
			test.prepare.account({ id: "ana", role: "member" });
			await test.prepare.password("ana", PASSWORD);
			test.background.start();
			signedIn.push(await signIn(test));
			await backUp(test);
			signedIn.push(await signIn(test));
			for (const browser of signedIn) expect((await listSessions(browser)).status).toBe(200);
		}

		await restoreBackup({
			file: target.databaseFile,
			modules: [ledger],
			backups: target.backups,
		});

		await using test = open(target);
		for (const before of signedIn) {
			const browser = test.browser();
			for (const [name, value] of Object.entries(before.cookies()))
				browser.setCookie(name, value);
			expect((await listSessions(browser)).status).toBe(401);
		}
	});

	it("ends the pending confirmations and the proofs: kept from before the backup, they no longer authorize their operation", async () => {
		using target = restoreTarget();
		const change = { account: "ana", area: "platform", level: "write", value: "no" } as const;
		// A proof is good for five minutes: asked a minute before the backup, used a minute after it.
		const asked = FIRST_BACKUP - 60_000;
		const used = FIRST_BACKUP + 60_000;
		let pending = "";
		let proof = "";
		{
			await using test = open(target);
			test.clock.set(asked);
			test.prepare.account({ id: "ana", role: "member" });
			await test.prepare.password("ana", PASSWORD);
			test.prepare.delegation("ana", "platform", "read", "confirm");
			pending = pendingFrom(() =>
				test.delegation(test.context("ana", { via: "kira" }), "ana"),
			);
			({ proof } = await test.requestProof(test.context("ana"), PASSWORD, {
				action: "platform.setDelegation",
				input: change,
			}));
			test.background.start();
			await backUp(test);
		}

		const { preserved } = await restoreBackup({
			file: target.databaseFile,
			modules: [ledger],
			backups: target.backups,
			at: used,
		});

		{
			await using test = open(target);
			test.clock.set(used);
			expect(() => test.confirm(test.context("ana"), pending)).toThrow(
				expect.objectContaining({ code: "CONFLICT" }),
			);
			expect(() =>
				test.setDelegation(test.context("ana"), change, { idempotencyKey: "after", proof }),
			).toThrow(expect.objectContaining({ code: "STEP_UP_REQUIRED" }));
		}
		// The previous set, kept apart and never restored, still honours both.
		await using before = createTestPlatform({
			modules: [ledger],
			file: join(preserved, "domus.db"),
		});
		before.clock.set(used);
		expect(before.confirm(before.context("ana"), pending)).toEqual(
			expect.objectContaining({ platform: expect.anything() }),
		);
		expect(
			before.setDelegation(before.context("ana"), change, {
				idempotencyKey: "before",
				proof,
			}),
		).toEqual(expect.objectContaining({ entry: expect.any(Number) }));
	});

	it("refuses while a platform has the database open", async () => {
		using target = restoreTarget();
		await using test = open(target);
		test.background.start();
		await backUp(test);

		await expect(
			restoreBackup({
				file: target.databaseFile,
				modules: [ledger],
				backups: target.backups,
			}),
		).rejects.toThrow("the database is in use: stop api and accounts first");
	});

	it("keeps the previous set apart in before-restore-<instant>, and leaves no old auxiliary file beside the restored database", async () => {
		using target = restoreTarget();
		await backedUpThenNoted(target);

		const { preserved } = await restoreBackup({
			file: target.databaseFile,
			modules: [ledger],
			backups: target.backups,
			at: Date.parse("2026-01-03T10:20:30Z"),
		});

		expect(preserved).toBe(join(target.data, "before-restore-20260103T102030Z"));
		expect(
			readdirSync(target.data)
				.filter((name) => !name.startsWith("domus.lock"))
				.sort(),
		).toEqual([
			"backup-staging",
			"before-restore-20260103T102030Z",
			"domus.db",
			"restore-staging",
		]);
		expect(readdirSync(join(target.data, "restore-staging"))).toEqual([]);
		{
			await using before = createTestPlatform({
				modules: [ledger],
				file: join(preserved, "domus.db"),
			});
			expect(notes(before)).toEqual([{ value: 1 }, { value: 2 }]);
		}
		await using test = open(target);
		expect(notes(test)).toEqual([{ value: 1 }]);
	});

	it("leaves a backup of ten days ago stale, and marks where it came from without crediting a check", async () => {
		using target = restoreTarget();
		await backedUpThenNoted(target);
		const [snapshot] = await listBackups(target.backups);
		const restoredAt = FIRST_BACKUP + 10 * DAY;

		await restoreBackup({
			file: target.databaseFile,
			modules: [ledger],
			backups: target.backups,
			at: restoredAt,
		});

		await using test = open(target);
		test.background.start();
		test.clock.set(restoredAt);
		expect(await health(test)).toEqual({
			status: "ok",
			background: { status: "degraded", reasons: ["backup-stale"], backups: "saved" },
		});
		expect(test.background.marks()).toEqual(
			expect.objectContaining({
				saved: { capturedAt: FIRST_BACKUP, snapshot: snapshot?.id },
				check: null,
				restored: { snapshot: snapshot?.id, capturedAt: FIRST_BACKUP, at: restoredAt },
			}),
		);
	});

	it("lists the snapshots of host domus with their capture, and restores the one chosen by a prefix of its id", async () => {
		using target = restoreTarget();
		expect(await listBackups(target.backups)).toEqual([]);
		{
			await using test = open(target);
			const ana = test.member("ana");
			test.background.start();
			test.invoke(ana, "ledger.note", { value: 1 }, { idempotencyKey: "one" });
			await backUp(test);
			test.invoke(ana, "ledger.note", { value: 2 }, { idempotencyKey: "two" });
			await backUp(test, FIRST_BACKUP + DAY);
		}

		const listed = await listBackups(target.backups);
		expect(listed).toEqual([
			{ id: expect.stringMatching(/^[0-9a-f]{64}$/), capturedAt: FIRST_BACKUP },
			{ id: expect.stringMatching(/^[0-9a-f]{64}$/), capturedAt: FIRST_BACKUP + DAY },
		]);
		const first = listed[0]?.id ?? "";

		const restored = await restoreBackup({
			file: target.databaseFile,
			modules: [ledger],
			backups: target.backups,
			snapshot: first.slice(0, 8),
		});

		expect(restored).toEqual(
			expect.objectContaining({ snapshot: first, capturedAt: FIRST_BACKUP, resumed: false }),
		);
		await using test = open(target);
		expect(notes(test)).toEqual([{ value: 1 }]);
	});
});

describe("restoring a backup with other migrations", { timeout: RESTIC_TIMEOUT }, () => {
	const first: ModuleMigration = {
		tag: "0000_shelf",
		position: 0,
		hash: "hash-of-0000_shelf",
		statements: ["CREATE TABLE `shelf_items` (`id` integer PRIMARY KEY);"],
	};
	const second: ModuleMigration = {
		tag: "0001_shelf_size",
		position: 1,
		hash: "hash-of-0001_shelf_size",
		statements: ["ALTER TABLE `shelf_items` ADD `size` integer;"],
	};
	const broken: ModuleMigration = {
		tag: "0001_broken",
		position: 1,
		hash: "hash-of-0001_broken",
		statements: ["ALTER TABLE `nowhere` ADD `size` integer;"],
	};
	const shelf = (...migrations: ModuleMigration[]) =>
		defineModule({ id: "shelf", schema: {}, migrations });
	type Shelf = ReturnType<typeof shelf>;

	/** Backs up with `before`, adds a note after it, and restores with `after`. */
	async function restoreAcross(target: RestoreTarget, before: Shelf, after: Shelf) {
		{
			await using test = createTestPlatform({
				modules: [ledger, before],
				file: target.databaseFile,
				backups: target.backups,
			});
			const ana = test.member("ana");
			test.invoke(ana, "ledger.note", { value: 1 }, { idempotencyKey: "one" });
			test.background.start();
			await backUp(test);
			test.invoke(ana, "ledger.note", { value: 2 }, { idempotencyKey: "two" });
		}
		return restoreBackup({
			file: target.databaseFile,
			modules: [ledger, after],
			backups: target.backups,
		});
	}

	it("gives an older backup the migrations it lacks", async () => {
		using target = restoreTarget();

		await restoreAcross(target, shelf(first), shelf(first, second));

		await using test = createTestPlatform({
			modules: [ledger, shelf(first, second)],
			file: target.databaseFile,
		});
		expect(test.platform.appliedMigrations).toBe(0);
		expect(notes(test)).toEqual([{ value: 1 }]);
	});

	it.each([
		[
			"a backup newer than the code",
			shelf(first, second),
			shelf(first),
			'module "shelf": migration "0001_shelf_size" is applied, but it is missing from the code',
		],
		[
			"a migration that fails",
			shelf(first),
			shelf(first, broken),
			'module "shelf": migration "0001_broken" failed',
		],
	])(
		"rejects %s and leaves the live database untouched",
		async (_case, before, after, message) => {
			using target = restoreTarget();

			await expect(restoreAcross(target, before, after)).rejects.toThrow(message);

			expect(
				readdirSync(target.data).filter((name) => name.startsWith("before-restore")),
			).toEqual([]);
			expect(readdirSync(join(target.data, "restore-staging"))).toEqual([]);
			await using test = createTestPlatform({
				modules: [ledger, before],
				file: target.databaseFile,
			});
			expect(notes(test)).toEqual([{ value: 1 }, { value: 2 }]);
		},
	);
});

describe("a restore that did not end", { timeout: RESTIC_TIMEOUT }, () => {
	it("follows a marker written by hand: opening refuses, and restoring again only ends the exchange", async () => {
		using target = restoreTarget();
		await backedUpThenNoted(target);
		const done = await restoreBackup({
			file: target.databaseFile,
			modules: [ledger],
			backups: target.backups,
		});
		// The state right before removing the marker: the restored database installed, the marker still there.
		writeFileSync(
			join(target.data, MARKER),
			JSON.stringify({
				preserved: "before-restore-20260101T000000Z",
				snapshot: done.snapshot,
				capturedAt: done.capturedAt,
				at: TEST_START,
			}),
		);

		expect(() => open(target)).toThrow("restore incomplete: run restore again");
		const resumed = await restoreBackup({
			file: target.databaseFile,
			modules: [ledger],
			backups: target.backups,
			at: FIRST_BACKUP + DAY,
		});

		expect(resumed).toEqual({ ...done, resumed: true });
		expect(
			readdirSync(target.data).filter((name) => name.startsWith("before-restore")),
		).toEqual(["before-restore-20260101T000000Z"]);
		await using test = open(target);
		expect(notes(test)).toEqual([{ value: 1 }]);
	});

	it("blocks opening and restoring alike when its marker cannot be read", async () => {
		using target = restoreTarget();
		await backedUpThenNoted(target);
		writeFileSync(join(target.data, MARKER), "not a marker");

		expect(() => open(target)).toThrow("restore marker unreadable");
		await expect(
			restoreBackup({
				file: target.databaseFile,
				modules: [ledger],
				backups: target.backups,
			}),
		).rejects.toThrow("restore marker unreadable");
	});
});

describe("restoring over a database in trouble", { timeout: RESTIC_TIMEOUT }, () => {
	it("keeps a previous set whose committed writes are still in its WAL, and opened there it holds them", async () => {
		using target = restoreTarget();
		await backedUpThenNotedIntoWal(target);

		const { preserved } = await restoreBackup({
			file: target.databaseFile,
			modules: [ledger],
			backups: target.backups,
		});

		expect(readdirSync(preserved).sort()).toEqual(["domus.db", "domus.db-wal"]);
		// The database alone lacks the second note: it lives only in the WAL kept beside it.
		const alone = join(target.data, "..", "alone");
		mkdirSync(alone);
		copyFileSync(join(preserved, "domus.db"), join(alone, "domus.db"));
		expect(await notesOf(join(alone, "domus.db"))).toEqual([{ value: 1 }]);
		expect(await notesOf(join(preserved, "domus.db"))).toEqual([{ value: 1 }, { value: 2 }]);
		await using test = open(target);
		expect(notes(test)).toEqual([{ value: 1 }]);
	});

	it("works over a damaged database without opening it, and keeps its files as they were", async () => {
		using target = restoreTarget();
		await backedUpThenNoted(target);
		const damaged = { "domus.db": randomBytes(8192), "domus.db-wal": randomBytes(4096) };
		for (const [name, bytes] of Object.entries(damaged))
			writeFileSync(join(target.data, name), bytes);

		const { preserved } = await restoreBackup({
			file: target.databaseFile,
			modules: [ledger],
			backups: target.backups,
		});

		expect(readdirSync(preserved).sort()).toEqual(["domus.db", "domus.db-wal"]);
		for (const [name, bytes] of Object.entries(damaged))
			expect(readFileSync(join(preserved, name)).equals(bytes)).toBe(true);
		expect(readdirSync(target.data)).not.toContain("domus.db-wal");
		await using test = open(target);
		expect(notes(test)).toEqual([{ value: 1 }]);
	});

	it("installs the prepared copy when there is no database, and never leaves an empty one", async () => {
		using target = restoreTarget();
		await backedUpThenNoted(target);
		for (const name of ["domus.db", "domus.db-wal", "domus.db-shm"])
			rmSync(join(target.data, name), { force: true });
		const seen: [string, string][] = [];

		const { preserved } = await restoreBackup({
			file: target.databaseFile,
			modules: [ledger],
			backups: target.backups,
			cut: (point) => {
				seen.push([point, databaseIn(target)]);
			},
		});

		expect(seen).toEqual([
			["marker-written", "absent"],
			["marker-published", "absent"],
			["auxiliaries-removed", "absent"],
			["database-renamed", "sqlite"],
			["database-installed", "sqlite"],
		]);
		expect(readdirSync(preserved)).toEqual([]);
		await using test = open(target);
		expect(notes(test)).toEqual([{ value: 1 }]);
	});
});

describe("a restore killed by SIGKILL", { timeout: RESTIC_TIMEOUT }, () => {
	/** The folders `before-restore-…` of the data folder, sorted. */
	const preservedSets = (target: RestoreTarget) =>
		readdirSync(target.data)
			.filter((name) => name.startsWith("before-restore"))
			.sort();

	/** What the data folder holds besides the lock, the staging folders and the preserved sets. */
	const installed = (target: RestoreTarget) =>
		readdirSync(target.data)
			.filter(
				(name) =>
					!/^(domus\.lock|before-restore|backup-staging$|restore-staging$)/.test(name),
			)
			.sort();

	/** A child restoring over the target, killed once it reached `at`: while it holds, nothing opens. */
	async function killedAt(target: RestoreTarget, at: RestorePoint): Promise<void> {
		await using child = await startChild({
			hold: "restore",
			dataDirectory: target.data,
			backups: target.backups,
			at,
		});
		expect(() => open(target)).toThrow("restore in progress");
		expect(databaseIn(target)).toBe("sqlite");
		await child.kill();
	}

	/** Opens the restored database: the backup's data, and the backup's own running job discarded. */
	async function expectRestoredSanitized(target: RestoreTarget): Promise<void> {
		await using test = open(target);
		expect(notes(test)).toEqual([{ value: 1 }]);
		expect(test.background.jobs().filter((job) => job.kind === "backup")).toEqual([
			expect.objectContaining({ state: "cancelled", error: "discarded by restore" }),
		]);
	}

	it("before the marker is renamed: opening starts with the previous database whole, and restoring again starts over", async () => {
		using target = restoreTarget();
		await backedUpThenNotedIntoWal(target);
		await killedAt(target, "marker-written");
		const [cut] = preservedSets(target);

		{
			// No marker: the previous database is in its place, and api may write on it.
			await using test = open(target);
			expect(notes(test)).toEqual([{ value: 1 }, { value: 2 }]);
			test.invoke(
				test.member("ana"),
				"ledger.note",
				{ value: 3 },
				{ idempotencyKey: "three" },
			);
		}
		const again = await restoreBackup({
			file: target.databaseFile,
			modules: [ledger],
			backups: target.backups,
		});

		expect(again).toEqual(
			expect.objectContaining({
				resumed: false,
				preserved: join(target.data, "before-restore-20260101T000000Z"),
			}),
		);
		// The set of the cut attempt stays behind, spare and harmless.
		expect(preservedSets(target)).toEqual([cut, "before-restore-20260101T000000Z"].sort());
		expect(installed(target)).toEqual(["domus.db"]);
		expect(databaseIn(target)).toBe("sqlite");
		await expectRestoredSanitized(target);
		expect(await notesOf(join(again.preserved, "domus.db"))).toEqual([
			{ value: 1 },
			{ value: 2 },
			{ value: 3 },
		]);
	});

	it.each<RestorePoint>([
		"marker-published",
		"auxiliaries-removed",
		"database-renamed",
		"database-installed",
	])(
		"at %s: opening refuses, and restoring again resumes from the marker without another preserved set",
		async (at) => {
			using target = restoreTarget();
			await backedUpThenNotedIntoWal(target);
			await killedAt(target, at);
			const [cut] = preservedSets(target);

			expect(() => open(target)).toThrow("restore incomplete: run restore again");
			const again = await restoreBackup({
				file: target.databaseFile,
				modules: [ledger],
				backups: target.backups,
			});

			expect(again).toEqual(
				expect.objectContaining({ resumed: true, preserved: join(target.data, cut ?? "") }),
			);
			expect(preservedSets(target)).toEqual([cut]);
			expect(installed(target)).toEqual(["domus.db"]);
			expect(databaseIn(target)).toBe("sqlite");
			await expectRestoredSanitized(target);
			// The previous set, its WAL with the second note included, is whole.
			expect(await notesOf(join(again.preserved, "domus.db"))).toEqual([
				{ value: 1 },
				{ value: 2 },
			]);
		},
	);
});

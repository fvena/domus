// The nightly backup carries the file contents its database needs (ADR 0028, spec of phase 1d3, «Copia»), with the
// real restic: probe's notes with photos on a file, a temporary repository and password file, run by the test's
// clock. What a test checks is what restic lists in the snapshot, what the runs and `/health` say, and what stays
// in the staging folder.
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";

import {
	contentPath,
	createTestPlatform,
	fakeNode,
	TEST_ORIGIN,
	type TestBackups,
	type TestBrowser,
	type TestPlatform,
	type VerifiedContext,
} from "@domus/test-utils";
import { describe, expect, it, vi } from "vitest";

import probe from "../server";

const PASSWORD = "correct horse battery staple";

/** 05:00 in Madrid on the first day of the test clock, when the first backup is due. */
const FIRST_BACKUP = Date.parse("2026-01-01T04:00:00Z");
/** restic derives its key on every open of the repository, which takes about a second each time. */
const RESTIC_TIMEOUT = 30_000;
const HOUR = 60 * 60 * 1000;
/** The maintenance lane's maximum time, the backup's. */
const MAINTENANCE_TIMEOUT = 30 * 60 * 1000;

/** Room enough on the volume for every upload of these tests, whatever the machine has free. */
const ROOMY = () => 100 * 1024 * 1024 * 1024;

/** A JPEG's signature followed by `tag`: a content of its own for each tag. */
function photo(tag: string): Uint8Array<ArrayBuffer> {
	const text = new TextEncoder().encode(tag);
	const bytes = new Uint8Array(4 + text.length);
	bytes.set([0xff, 0xd8, 0xff, 0xe0]);
	bytes.set(text, 4);
	return bytes;
}

function sha256(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

/** Where a content lies in a snapshot: under `files/`, as in the store, whatever the data folder. */
const inSnapshot = (bytes: Uint8Array) => {
	return contentPath("/files", sha256(bytes));
};

/** A temporary repository folder, empty, and a password file, removed at the end of a `using` block. */
function backupTarget(): TestBackups & Disposable {
	const dir = mkdtempSync(join(tmpdir(), "domus-probe-backups-"));
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

/** The files restic lists in the latest snapshot of the target, by path. */
function snapshotFiles(target: TestBackups): string[] {
	const output = execFileSync("restic", ["ls", "latest", "--no-cache", "--json"], {
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
		.map((line) => JSON.parse(line) as { struct_type?: string; type?: string; path?: string })
		.filter((node) => node.struct_type === "node" && node.type === "file")
		.map((node) => node.path ?? "")
		.sort();
}

type Probe = TestPlatform<readonly [typeof probe]>;

/** Probe on a file with the backups on `target`, Ana signed in on her phone with a note. */
async function household(target: TestBackups, retention?: number) {
	const test: Probe = createTestPlatform({
		modules: [probe],
		file: true,
		backups: target,
		freeSpace: ROOMY,
		...(retention === undefined ? {} : { retention }),
	});
	test.prepare.account({ id: "ana", role: "member" });
	await test.prepare.password("ana", PASSWORD);
	const phone = test.browser();
	expect((await phone.signIn("ana@domus.test", PASSWORD)).status).toBe(200);
	const ana = test.contextOf(phone);
	test.invoke(ana, "probe.addNote", { body: "nevera" }, { idempotencyKey: "n1" });
	return { test, phone, ana };
}

/** Uploads `bytes` from `browser` and returns the id of the prepared file. */
async function prepare(browser: TestBrowser, bytes: Uint8Array<ArrayBuffer>): Promise<string> {
	const response = await browser.fetch(
		new Request(new URL("/api/files", TEST_ORIGIN), {
			method: "POST",
			body: bytes,
			headers: {
				"content-length": String(bytes.length),
				"x-file-name": encodeURIComponent("foto.jpg"),
			},
		}),
	);
	expect(response.status).toBe(200);
	return ((await response.json()) as { id: string }).id;
}

let keys = 0;
/** Runs a write of probe as `context` with a fresh key and returns its result. */
function write(test: Probe, context: VerifiedContext, action: string, input: unknown) {
	const outcome = test.invoke(
		context,
		action as "probe.attachFile",
		input as { noteId: number; prepared: string },
		{ idempotencyKey: `k-${String(++keys)}` },
	);
	if ("repeated" in outcome) throw new Error("expected a first write");
	return outcome;
}

/** Uploads `bytes` and attaches them to note 1: the file's id. */
async function attached(
	test: Probe,
	phone: TestBrowser,
	ana: VerifiedContext,
	bytes: Uint8Array<ArrayBuffer>,
): Promise<string> {
	const prepared = await prepare(phone, bytes);
	return write(test, ana, "probe.attachFile", { noteId: 1, prepared }).result.id;
}

/**
 * A fake restic whose `backup` notes what the staging folder holds, its working folder, and then never ends on its
 * own; it hands every other subcommand to the real restic.
 */
function stuckBackup() {
	const dir = mkdtempSync(join(tmpdir(), "domus-probe-fake-restic-"));
	const executable = join(dir, "restic");
	const listing = join(dir, "staged");
	writeFileSync(
		executable,
		`#!/bin/sh
if [ "$1" = backup ]; then
	find . -type f | sed 's|^\\./||' | sort > '${listing}.tmp'
	mv '${listing}.tmp' '${listing}'
	while true; do sleep 0.1; done
fi
exec restic "$@"
`,
	);
	chmodSync(executable, 0o755);
	return {
		executable,
		/** What the staging folder held when `backup` started; undefined before. */
		staged: (): string[] | undefined =>
			existsSync(listing) ? readFileSync(listing, "utf8").trim().split("\n") : undefined,
		[Symbol.dispose]: () => rmSync(dir, { recursive: true, force: true }),
	};
}

/** What `/health` answers over the door. */
async function health(test: Probe): Promise<unknown> {
	const response = await test.door.fetch(new Request(`${TEST_ORIGIN}/health`));
	return response.json();
}

/** The runs of the backup task, oldest first. */
const backupRuns = (test: Probe) => test.background.runs().filter((run) => run.task === "backup");

/** Every file left in the backups' staging folder, links included. */
function staged(test: Probe): string[] {
	const staging = join(dirname(test.databaseFile), "backup-staging");
	return readdirSync(staging, { recursive: true, withFileTypes: true })
		.filter((entry) => !entry.isDirectory())
		.map((entry) => relative(staging, join(entry.parentPath, entry.name)));
}

describe("the contents a backup carries", { timeout: RESTIC_TIMEOUT }, () => {
	it("saves the database and the contents of a live file and of a released one still undoable, under files/", async () => {
		using target = backupTarget();
		const { test, phone, ana } = await household(target);
		await using _ = test;
		const live = photo("live");
		const released = photo("released");
		await attached(test, phone, ana, live);
		const off = await attached(test, phone, ana, released);
		write(test, ana, "probe.detachFile", { noteId: 1, file: off });
		test.background.start();

		test.clock.set(FIRST_BACKUP);
		await test.background.settled();

		expect(backupRuns(test).map((run) => run.result)).toEqual(["ok"]);
		expect(snapshotFiles(target)).toEqual(
			["/domus.db", inSnapshot(live), inSnapshot(released)].sort(),
		);
		expect(staged(test)).toEqual([]);
	});
});

describe("the contents a backup leaves out", { timeout: RESTIC_TIMEOUT }, () => {
	it("leaves out a prepared file and one released past its undo at the capture, keeping one that expires during the run", async () => {
		using target = backupTarget();
		using node = fakeNode({ pause: true });
		const { test, phone, ana } = await household({ ...target, node: node.executable }, HOUR);
		await using _ = test;
		const live = photo("live");
		const expired = photo("expired");
		const expiring = photo("expiring");
		await attached(test, phone, ana, live);
		const gone = await attached(test, phone, ana, expired);
		const going = await attached(test, phone, ana, expiring);
		await prepare(phone, photo("prepared"));
		// Released at 00:00, its undo ends at 01:00: past at the capture, 04:00.
		write(test, ana, "probe.detachFile", { noteId: 1, file: gone });
		// Released at 03:05, its undo ends at 04:05: still undoable at the capture, past by the end of the run.
		test.clock.set(Date.parse("2026-01-01T03:05:00Z"));
		write(test, ana, "probe.detachFile", { noteId: 1, file: going });
		test.background.start();

		test.clock.set(FIRST_BACKUP);
		await vi.waitFor(() => expect(node.pausedChild()).toBeDefined(), {
			timeout: RESTIC_TIMEOUT / 2,
		});
		// The copy takes ten minutes.
		test.clock.advance(10 * 60 * 1000);
		node.resume();
		await test.background.settled();

		expect(backupRuns(test).map((run) => run.result)).toEqual(["ok"]);
		expect(snapshotFiles(target)).toEqual(
			["/domus.db", inSnapshot(live), inSnapshot(expiring)].sort(),
		);
		expect(staged(test)).toEqual([]);
	});
});

describe("a backup that cannot carry its contents", { timeout: RESTIC_TIMEOUT }, () => {
	it("fails at once when a content it needs is missing from the store, saving nothing and saying stale", async () => {
		using target = backupTarget();
		const { test, phone, ana } = await household(target);
		await using _ = test;
		const lost = photo("lost");
		await attached(test, phone, ana, photo("kept"));
		await attached(test, phone, ana, lost);
		const hash = sha256(lost);
		rmSync(contentPath(test.filesDirectory, hash));
		test.background.start();

		test.clock.set(FIRST_BACKUP);
		await test.background.settled();

		expect(backupRuns(test)).toEqual([
			expect.objectContaining({
				result: "failed",
				error: "PermanentJobError: a file content the backup needs is missing",
			}),
		]);
		expect(test.background.jobs().find((job) => job.kind === "backup")).toEqual(
			expect.objectContaining({ state: "failed", attempts: 1 }),
		);
		expect(test.background.marks().saved).toBeNull();
		expect(readdirSync(target.repository)).toEqual([]);
		expect(await health(test)).toEqual({
			status: "ok",
			background: { status: "degraded", reasons: ["backup-stale"], backups: "none" },
		});
		expect(staged(test)).toEqual([]);
	});

	it("leaves no link in the staging folder once a run with its links staged is cancelled", async () => {
		using target = backupTarget();
		using fake = stuckBackup();
		const { test, phone, ana } = await household({ ...target, restic: fake.executable });
		await using _ = test;
		const kept = photo("kept");
		await attached(test, phone, ana, kept);
		test.background.start();

		test.clock.set(FIRST_BACKUP);
		await vi.waitFor(() => expect(fake.staged()).toBeDefined(), {
			timeout: RESTIC_TIMEOUT / 2,
		});
		test.clock.advance(MAINTENANCE_TIMEOUT);
		await test.background.settled();

		expect(fake.staged()).toEqual(["domus.db", "paths", inSnapshot(kept).slice(1)].sort());
		expect(test.background.jobs().find((job) => job.kind === "backup")).toEqual(
			expect.objectContaining({
				state: "pending",
				error: `timed out after ${MAINTENANCE_TIMEOUT} ms`,
			}),
		);
		expect(staged(test)).toEqual([]);
	});
});

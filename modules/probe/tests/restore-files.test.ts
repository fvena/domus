// Restoring brings back the database and its file contents together, checked (ADR 0028, ADR 0026, spec of phase
// 1d3, «Restaurar» and seam 3 of «Decisiones de prueba»), with the real restic: probe's notes with photos on a data
// folder of the test, backed up by the nightly task, then restored with the platform closed. What a test checks is
// what the platform opened again answers, the hashes of what it downloads, what is left in the store and in the
// staging folder of restoring.
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative } from "node:path";

import {
	contentPath,
	createTestPlatform,
	restoreBackup,
	type RestorePoint,
	startChild,
	TEST_ORIGIN,
	TEST_START,
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
/** A while after the backup, inside the retention of what it released. */
const AFTER_BACKUP = FIRST_BACKUP + 60 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;
/** restic derives its key on every open of the repository, which takes about a second each time. */
const RESTIC_TIMEOUT = 60_000;

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

/**
 * A temporary data folder with the database and the store, a repository folder, empty, and a password file, removed
 * at the end of a `using` block.
 */
function restoreTarget() {
	const dir = mkdtempSync(join(tmpdir(), "domus-probe-restore-"));
	const data = join(dir, "data");
	mkdirSync(data);
	const repository = join(dir, "repository");
	mkdirSync(repository);
	const passwordFile = join(dir, "password");
	writeFileSync(passwordFile, randomBytes(24).toString("hex"), { mode: 0o600 });
	const backups: TestBackups = { repository, passwordFile };
	return {
		data,
		file: join(data, "domus.db"),
		files: join(data, "files"),
		backups,
		[Symbol.dispose]: () => rmSync(dir, { recursive: true, force: true }),
	};
}
type RestoreTarget = ReturnType<typeof restoreTarget>;

type Probe = TestPlatform<readonly [typeof probe]>;

/** Probe on the target's data folder, with the backups on. */
function open(target: RestoreTarget): Probe {
	return createTestPlatform({
		modules: [probe],
		file: target.file,
		files: target.files,
		backups: target.backups,
		freeSpace: ROOMY,
	});
}

/** A new browser signed in as Ana. */
async function signedIn(test: Probe): Promise<TestBrowser> {
	const browser = test.browser();
	expect((await browser.signIn("ana@domus.test", PASSWORD)).status).toBe(200);
	return browser;
}

/** Ana, a member with a password, signed in on her phone. */
async function household(test: Probe) {
	test.prepare.account({ id: "ana", role: "member" });
	await test.prepare.password("ana", PASSWORD);
	const phone = await signedIn(test);
	return { phone, ana: test.contextOf(phone) };
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
/** Runs a write of probe as `context` with a fresh key and returns its outcome. */
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

/** Uploads `bytes` and attaches them to note `noteId`: the file's id. */
async function attached(
	test: Probe,
	phone: TestBrowser,
	ana: VerifiedContext,
	noteId: number,
	bytes: Uint8Array<ArrayBuffer>,
): Promise<string> {
	const prepared = await prepare(phone, bytes);
	return write(test, ana, "probe.attachFile", { noteId, prepared }).result.id;
}

/** The SHA-256 of what downloading `file` through note `noteId` answers, once it answered 200. */
async function downloaded(browser: TestBrowser, noteId: number, file: string): Promise<string> {
	const response = await browser.fetch(
		new Request(new URL("/api/files/download", TEST_ORIGIN), {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ action: "probe.getNote", input: { id: noteId }, file }),
		}),
	);
	expect(response.status).toBe(200);
	return sha256(new Uint8Array(await response.arrayBuffer()));
}

/** Runs the nightly backup on a started platform and waits until it saved its snapshot. */
async function backUp(test: Probe): Promise<void> {
	test.background.start();
	test.clock.set(FIRST_BACKUP);
	await vi.waitFor(
		() => {
			const runs = test.background.runs().filter((run) => run.task === "backup");
			expect(runs[runs.length - 1]).toEqual(expect.objectContaining({ result: "ok" }));
		},
		{ timeout: RESTIC_TIMEOUT / 2, interval: 50 },
	);
}

/** Restores the latest snapshot onto the target, with probe, at `at`. */
function restore(target: RestoreTarget, at = AFTER_BACKUP) {
	return restoreBackup({
		file: target.file,
		files: target.files,
		modules: [probe],
		backups: target.backups,
		at,
	});
}

/** Every file left under a folder, by its path inside it; none when it does not exist. */
function filesUnder(folder: string): string[] {
	if (!existsSync(folder)) return [];
	return readdirSync(folder, { recursive: true, withFileTypes: true })
		.filter((entry) => !entry.isDirectory())
		.map((entry) => relative(folder, join(entry.parentPath, entry.name)))
		.sort();
}

/** What the staging folder of restoring holds. */
const staging = (target: RestoreTarget) => filesUnder(join(target.data, "restore-staging"));

/** Runs the real restic on the target's repository, in the folder `cwd` when given. */
function restic(target: RestoreTarget, args: readonly string[], cwd?: string): void {
	execFileSync("restic", [...args, "--no-cache"], {
		...(cwd === undefined ? {} : { cwd }),
		env: {
			PATH: process.env.PATH,
			RESTIC_REPOSITORY: target.backups.repository,
			RESTIC_PASSWORD_FILE: target.backups.passwordFile,
		},
		stdio: "ignore",
	});
}

/** Where a content lives in the target's store. */
function storedIn(target: RestoreTarget, bytes: Uint8Array): string {
	return contentPath(target.files, sha256(bytes));
}

describe("restoring a backup with files", { timeout: RESTIC_TIMEOUT }, () => {
	it("brings back the database and its contents into an emptied data folder, and the downloads match by hash", async () => {
		using target = restoreTarget();
		const fridge = photo("nevera");
		const oven = photo("horno");
		let photos: string[];
		{
			await using test = open(target);
			const { phone, ana } = await household(test);
			write(test, ana, "probe.addNote", { body: "nevera" });
			write(test, ana, "probe.addNote", { body: "horno" });
			photos = [
				await attached(test, phone, ana, 1, fridge),
				await attached(test, phone, ana, 2, oven),
			];
			await backUp(test);
		}
		// Another machine: nothing of the data folder is left.
		rmSync(target.data, { recursive: true });
		mkdirSync(target.data);

		await restore(target);

		await using test = open(target);
		const phone = await signedIn(test);
		expect(await downloaded(phone, 1, photos[0] ?? "")).toBe(sha256(fridge));
		expect(await downloaded(phone, 2, photos[1] ?? "")).toBe(sha256(oven));
		expect(staging(target)).toEqual([]);
	});

	it("brings back the photo of a deletion the backup could still undo, and undoing it reattaches the photo", async () => {
		using target = restoreTarget();
		const fridge = photo("nevera");
		let file: string;
		let deletion: number;
		{
			await using test = open(target);
			const { phone, ana } = await household(test);
			write(test, ana, "probe.addNote", { body: "nevera" });
			file = await attached(test, phone, ana, 1, fridge);
			deletion = write(test, ana, "probe.deleteNote", { id: 1 }).entry;
			await backUp(test);
		}
		rmSync(target.data, { recursive: true });
		mkdirSync(target.data);

		await restore(target);

		await using test = open(target);
		const phone = await signedIn(test);
		const ana = test.contextOf(phone);
		test.undo(ana, deletion, { idempotencyKey: "undo" });
		expect(await downloaded(phone, 1, file)).toBe(sha256(fridge));
	});

	it("mends a live content that was damaged, without reading it", async () => {
		using target = restoreTarget();
		const fridge = photo("nevera");
		let file: string;
		{
			await using test = open(target);
			const { phone, ana } = await household(test);
			write(test, ana, "probe.addNote", { body: "nevera" });
			file = await attached(test, phone, ana, 1, fridge);
			await backUp(test);
		}
		writeFileSync(storedIn(target, fridge), "damaged");

		await restore(target);

		await using test = open(target);
		const phone = await signedIn(test);
		expect(await downloaded(phone, 1, file)).toBe(sha256(fridge));
	});

	it("leaves a prepared file of the backup useless, and an upload of its bytes after restoring stores them again", async () => {
		using target = restoreTarget();
		const fridge = photo("nevera");
		let prepared: string;
		{
			await using test = open(target);
			const { phone, ana } = await household(test);
			write(test, ana, "probe.addNote", { body: "nevera" });
			prepared = await prepare(phone, fridge);
			await backUp(test);
		}
		rmSync(target.data, { recursive: true });
		mkdirSync(target.data);

		await restore(target);

		await using test = open(target);
		const phone = await signedIn(test);
		const ana = test.contextOf(phone);
		expect(() =>
			test.invoke(
				ana,
				"probe.attachFile",
				{ noteId: 1, prepared },
				{ idempotencyKey: "old" },
			),
		).toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
		const file = await attached(test, phone, ana, 1, fridge);
		expect(await downloaded(phone, 1, file)).toBe(sha256(fridge));
	});

	it("drops a photo whose deletion can no longer be undone at the restore, and an upload of its bytes stores them again", async () => {
		using target = restoreTarget();
		const fridge = photo("nevera");
		{
			await using test = open(target);
			const { phone, ana } = await household(test);
			write(test, ana, "probe.addNote", { body: "nevera" });
			await attached(test, phone, ana, 1, fridge);
			write(test, ana, "probe.deleteNote", { id: 1 });
			await backUp(test);
		}
		rmSync(target.data, { recursive: true });
		mkdirSync(target.data);

		// The deletion's undo ended 30 days after it.
		await restore(target, FIRST_BACKUP + 31 * DAY);

		expect(filesUnder(target.files)).toEqual([]);
		await using test = open(target);
		const phone = await signedIn(test);
		const ana = test.contextOf(phone);
		write(test, ana, "probe.addNote", { body: "otra nevera" });
		const file = await attached(test, phone, ana, 2, fridge);
		expect(await downloaded(phone, 2, file)).toBe(sha256(fridge));
	});
});

describe("refusing to restore a backup with files", { timeout: RESTIC_TIMEOUT }, () => {
	/** Every file of the store with its bytes, to tell it was not touched. */
	function store(target: RestoreTarget): Record<string, string> {
		return Object.fromEntries(
			filesUnder(target.files).map((path) => [
				path,
				readFileSync(join(target.files, path), "hex"),
			]),
		);
	}

	/** The notes Ana sees once the platform is open again on the target. */
	async function notesAfter(target: RestoreTarget) {
		await using test = open(target);
		return test.invoke(test.member("ana"), "probe.listNotes").map(({ body }) => body);
	}

	it("refuses a content the database needs that was damaged in the backup, touching neither the database nor the store", async () => {
		using target = restoreTarget();
		const fridge = photo("nevera");
		{
			await using test = open(target);
			const { phone, ana } = await household(test);
			write(test, ana, "probe.addNote", { body: "nevera" });
			await attached(test, phone, ana, 1, fridge);
			// The backup carries the bytes as the store has them, damaged.
			writeFileSync(storedIn(target, fridge), "damaged");
			await backUp(test);
			// Mended in the store; a note after the backup.
			writeFileSync(storedIn(target, fridge), fridge);
			write(test, ana, "probe.addNote", { body: "horno" });
		}
		const before = store(target);

		await expect(restore(target)).rejects.toThrow(
			"a file content of the backup does not match its hash",
		);

		expect(store(target)).toEqual(before);
		expect(staging(target)).toEqual([]);
		expect(await notesAfter(target)).toEqual(["nevera", "horno"]);
	});

	it("refuses a content the database needs that the backup lacks, touching neither the database nor the store", async () => {
		using target = restoreTarget();
		{
			await using test = open(target);
			const { phone, ana } = await household(test);
			write(test, ana, "probe.addNote", { body: "nevera" });
			await attached(test, phone, ana, 1, photo("nevera"));
			await backUp(test);
			write(test, ana, "probe.addNote", { body: "horno" });
		}
		// A later snapshot with the database alone.
		const lone = mkdtempSync(join(tmpdir(), "domus-probe-lone-"));
		try {
			restic(target, ["restore", "latest", "--target", lone, "--include", "/domus.db"]);
			restic(
				target,
				["backup", "--host", "domus", "--time", "2026-01-02 04:00:00", "domus.db"],
				lone,
			);
		} finally {
			rmSync(lone, { recursive: true, force: true });
		}
		const before = store(target);

		await expect(restore(target)).rejects.toThrow(
			"the backup lacks a file content its database needs",
		);

		expect(store(target)).toEqual(before);
		expect(staging(target)).toEqual([]);
		expect(await notesAfter(target)).toEqual(["nevera", "horno"]);
	});
});

describe("a restore with files killed by SIGKILL", { timeout: RESTIC_TIMEOUT }, () => {
	const fridge = photo("nevera");
	const oven = photo("horno");

	/**
	 * Backs up two notes of Ana's with a photo each, then leaves another previous database in an emptied data folder:
	 * one note of Ana's, without photos. The ids of the photos, by note.
	 */
	async function backedUpThenReplaced(target: RestoreTarget): Promise<string[]> {
		let photos: string[];
		{
			await using test = open(target);
			const { phone, ana } = await household(test);
			write(test, ana, "probe.addNote", { body: "nevera" });
			write(test, ana, "probe.addNote", { body: "horno" });
			photos = [
				await attached(test, phone, ana, 1, fridge),
				await attached(test, phone, ana, 2, oven),
			];
			await backUp(test);
		}
		rmSync(target.data, { recursive: true });
		mkdirSync(target.data);
		await using test = open(target);
		await household(test);
		write(test, test.member("ana"), "probe.addNote", { body: "anterior" });
		return photos;
	}

	/** A child restores the latest snapshot onto the target and is killed at `at`. */
	async function cutAt(target: RestoreTarget, at: RestorePoint): Promise<void> {
		const child = await startChild({
			hold: "restore",
			dataDirectory: target.data,
			backups: target.backups,
			modules: [{ id: probe.id, migrations: probe.migrations }],
			at,
		});
		await child.kill();
	}

	/** The hashes of the contents in the target's store. */
	const stored = (target: RestoreTarget) =>
		filesUnder(join(target.files, "contents")).map((path) => basename(path));

	/** Restores again, opens, and checks that every photo of the backup downloads whole and nothing is staged. */
	async function restoredWithEveryPhoto(
		target: RestoreTarget,
		photos: string[],
		resumed: boolean,
	): Promise<void> {
		expect(await restore(target)).toEqual(expect.objectContaining({ resumed }));
		await using test = open(target);
		const phone = await signedIn(test);
		expect(await downloaded(phone, 1, photos[0] ?? "")).toBe(sha256(fridge));
		expect(await downloaded(phone, 2, photos[1] ?? "")).toBe(sha256(oven));
		expect(staging(target)).toEqual([]);
	}

	it.each([
		["one of the two contents", "content-installed", 1],
		["both contents, before the marker", "contents-installed", 2],
	] as const)(
		"after installing %s: the previous database opens whole, the cleanup collects what was installed, and restoring again ends well",
		async (_, at, count) => {
			using target = restoreTarget();
			const photos = await backedUpThenReplaced(target);

			await cutAt(target, at);

			const installed = stored(target);
			expect(installed).toHaveLength(count);
			expect([fridge, oven].map(sha256)).toEqual(expect.arrayContaining(installed));
			{
				await using test = open(target);
				expect(
					test.invoke(test.member("ana"), "probe.listNotes").map(({ body }) => body),
				).toEqual(["anterior"]);
				// restic gives each content the time of its backup: here, more than an hour before the night.
				for (const hash of installed) {
					const path = contentPath(target.files, hash);
					utimesSync(path, new Date(TEST_START), new Date(TEST_START));
				}
				test.background.start();
				// 04:30 in Madrid on the first day, before the backup's 05:00: only the cleanup runs.
				test.clock.set(Date.parse("2026-01-01T03:30:00Z"));
				await test.background.settled();
				expect(stored(target)).toEqual([]);
			}

			await restoredWithEveryPhoto(target, photos, false);
		},
	);

	it("once the marker is published: opening refuses, the contents are installed, and restoring again resumes with every photo", async () => {
		using target = restoreTarget();
		const photos = await backedUpThenReplaced(target);

		await cutAt(target, "marker-published");

		expect(() => open(target)).toThrow("restore incomplete: run restore again");
		expect(stored(target)).toEqual([fridge, oven].map(sha256).sort());
		await restoredWithEveryPhoto(target, photos, true);
	});
});

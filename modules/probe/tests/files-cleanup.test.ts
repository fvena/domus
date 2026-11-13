// The cleanup of files (ADR 0028, spec of phase 1d3, «Limpieza» and seam 2 of «Decisiones de prueba»): each night
// the cleanup takes what nothing protects any more out of the store, and never a content something has just hung
// from a note nor the file of a download already under way.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
	createTestPlatform,
	TEST_ORIGIN,
	TEST_START,
	type TestBrowser,
	type TestPlatform,
	type InterleavePoint,
	type TestPlatformOptions,
	type VerifiedContext,
} from "@domus/test-utils";
import { describe, expect, it } from "vitest";

import probe from "../server";

const PASSWORD = "correct horse battery staple";

const DAY = 24 * 60 * 60 * 1000;

/** Room enough on the volume for every upload of these tests, whatever the machine has free. */
const ROOMY = () => 100 * 1024 * 1024 * 1024;

/** The start of a JPEG and a few bytes of it: enough for its signature. */
const JPEG = Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00);

/** The start of a PNG: another content than {@link JPEG}. */
const PNG = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00);

/** A plain text: a third content. */
const TEXT = new TextEncoder().encode("hola");

type Probe = TestPlatform<readonly [typeof probe]>;

/** 04:30 in Madrid (CET, +01:00) on day `day` after the test's start: when the cleanup of that night runs. */
function nightOf(day: number): number {
	return TEST_START + day * DAY + 3.5 * 60 * 60 * 1000;
}

/**
 * A platform with probe where Ana, a member, has a password and a note, its background started. A deletion stays
 * undoable for a day.
 */
async function household(options: Partial<TestPlatformOptions<readonly [typeof probe]>> = {}) {
	const test: Probe = createTestPlatform({
		modules: [probe],
		freeSpace: ROOMY,
		retention: DAY,
		...options,
	});
	test.prepare.account({ id: "ana", role: "member" });
	await test.prepare.password("ana", PASSWORD);
	test.invoke(test.context("ana"), "probe.addNote", { body: "nevera" }, { idempotencyKey: "n1" });
	test.background.start();
	return test;
}

async function signedIn(test: Probe): Promise<TestBrowser> {
	const browser = test.browser();
	expect((await browser.signIn("ana@domus.test", PASSWORD)).status).toBe(200);
	return browser;
}

/** Sends `bytes` to the upload route. */
function upload(browser: TestBrowser, bytes: Uint8Array<ArrayBuffer> = JPEG): Promise<Response> {
	return browser.fetch(
		new Request(new URL("/api/files", TEST_ORIGIN), {
			method: "POST",
			body: bytes,
			headers: {
				"content-length": String(bytes.length),
				"x-file-name": encodeURIComponent("nevera rota.jpg"),
			},
		}),
	);
}

/** Uploads `bytes` and returns the id of the prepared file. */
async function prepare(browser: TestBrowser, bytes: Uint8Array<ArrayBuffer> = JPEG) {
	const response = await upload(browser, bytes);
	expect(response.status).toBe(200);
	return ((await response.json()) as { id: string }).id;
}

let keys = 0;
/** Runs a write of probe with a fresh key and gives its receipt. */
function write(test: Probe, context: VerifiedContext, action: string, input: unknown) {
	const outcome = test.invoke(context, action as "probe.attachFile", input as never, {
		idempotencyKey: `k-${String(++keys)}`,
	});
	if ("repeated" in outcome) throw new Error("expected a first write");
	return outcome;
}

/** Attaches a prepared file to Ana's note and returns the file's id. */
function attach(test: Probe, ana: VerifiedContext, prepared: string): string {
	return write(test, ana, "probe.attachFile", { noteId: 1, prepared }).result.id;
}

/** The last run of a scheduled task. */
function lastRun(test: Probe) {
	return test.background.runs().slice(-1)[0];
}

/** Runs the cleanup of night `day`, and expects it to end well. */
async function cleanOn(test: Probe, day: number): Promise<void> {
	test.clock.set(nightOf(day));
	await test.background.settled();
	expect(lastRun(test)).toEqual(expect.objectContaining({ task: "cleanup", result: "ok" }));
}

/** Every file under the store's contents, by its path inside it. */
function stored(test: Probe): string[] {
	const contents = join(test.filesDirectory, "contents");
	if (!existsSync(contents)) return [];
	return readdirSync(contents, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile())
		.map((entry) => entry.name)
		.sort();
}

/** The names in the folder of the uploads in progress. */
function incoming(test: Probe): string[] {
	const folder = join(test.filesDirectory, "incoming");
	return existsSync(folder) ? readdirSync(folder).sort() : [];
}

/** An upload of `size` bytes whose body the test sends when it wants. */
function controlledUpload(browser: TestBrowser, size: number) {
	let controller!: ReadableStreamDefaultController<Uint8Array>;
	const body = new ReadableStream<Uint8Array>({
		start: (started) => {
			controller = started;
		},
	});
	const response = browser.fetch(
		new Request(new URL("/api/files", TEST_ORIGIN), {
			method: "POST",
			body,
			duplex: "half",
			headers: { "content-length": String(size), "x-file-name": "foto.jpg" },
		} as RequestInit),
	);
	return {
		response,
		send: (bytes: Uint8Array) => controller.enqueue(bytes),
		end: () => controller.close(),
	};
}

/** Waits a few real milliseconds at a time until `done` holds. */
async function until(done: () => boolean): Promise<void> {
	for (let turn = 0; !done(); turn += 1) {
		if (turn > 2000) throw new Error("it never happened");
		await new Promise((resolve) => setTimeout(resolve, 1));
	}
}

/**
 * Holds the platform the first time it reaches `point` after passing it `skip` times, until the test lets it go;
 * every other point passes. Letting it go with a failure fails it there, as a cut would stop it.
 */
function holdAt(point: InterleavePoint, skip = 0) {
	let passed = 0;
	let reached!: () => void;
	const reaching = new Promise<void>((resolve) => {
		reached = resolve;
	});
	let release!: (failure?: Error) => void;
	const releasing = new Promise<void>((resolve, reject) => {
		release = (failure) => (failure === undefined ? resolve() : reject(failure));
	});
	let held = false;
	return {
		interleave: (at: InterleavePoint) => {
			if (at !== point || held) return undefined;
			if (passed < skip) {
				passed += 1;
				return undefined;
			}
			held = true;
			reached();
			return releasing;
		},
		reaching,
		release,
	};
}

function sha256(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Leaves the file of `bytes` in the store without its row, as a cut between publishing it and writing its row does,
 * last modified at `at`.
 */
function orphan(test: Probe, bytes: Uint8Array, at: number): void {
	const hash = sha256(bytes);
	const folder = join(test.filesDirectory, "contents", hash.slice(0, 2));
	mkdirSync(folder, { recursive: true });
	const path = join(folder, hash);
	writeFileSync(path, bytes);
	utimesSync(path, new Date(at), new Date(at));
}

const HOUR = 60 * 60 * 1000;

describe("the cleanup of the store", () => {
	it("deletes the content of a prepared file that expired unused", async () => {
		await using test = await household();
		const phone = await signedIn(test);
		await prepare(phone);
		expect(stored(test)).toEqual([sha256(JPEG)]);

		await cleanOn(test, 1);

		expect(stored(test)).toEqual([]);
	});

	it("deletes the content of a reference released by an entry that can no longer be undone", async () => {
		await using test = await household();
		const phone = await signedIn(test);
		const ana = test.contextOf(phone);
		const file = attach(test, ana, await prepare(phone));
		write(test, ana, "probe.detachFile", { noteId: 1, file });

		await cleanOn(test, 1);

		expect(stored(test)).toEqual([]);
	});

	it("keeps a content with a live reference, one released and still undoable, or a current prepared file", async () => {
		await using test = await household();
		const phone = await signedIn(test);
		const ana = test.contextOf(phone);
		attach(test, ana, await prepare(phone, JPEG));
		test.clock.set(TEST_START + DAY);
		const released = attach(test, ana, await prepare(phone, PNG));
		write(test, ana, "probe.detachFile", { noteId: 1, file: released });
		await prepare(phone, TEXT);

		await cleanOn(test, 1);

		expect(stored(test)).toEqual([sha256(JPEG), sha256(PNG), sha256(TEXT)].sort());
	});

	it("cleans nothing more the second time", async () => {
		await using test = await household();
		const phone = await signedIn(test);
		const ana = test.contextOf(phone);
		attach(test, ana, await prepare(phone, JPEG));
		await prepare(phone, PNG);
		await cleanOn(test, 1);
		const once = { stored: stored(test), note: test.invoke(ana, "probe.getNote", { id: 1 }) };

		await cleanOn(test, 2);

		expect(test.background.runs().map(({ result }) => result)).toEqual(["ok", "ok"]);
		expect({
			stored: stored(test),
			note: test.invoke(ana, "probe.getNote", { id: 1 }),
		}).toEqual(once);
		expect(once.stored).toEqual([sha256(JPEG)]);
	});
});

describe("the cleanup of files without a row", () => {
	it("deletes one left more than an hour ago, and keeps a younger one", async () => {
		await using test = await household();
		orphan(test, JPEG, nightOf(1) - HOUR - 1);
		orphan(test, PNG, nightOf(1) - HOUR);

		await cleanOn(test, 1);

		expect(stored(test)).toEqual([sha256(PNG)]);
	});

	it("keeps one an upload reuses while the cleanup waits for its hash, published with its row", async () => {
		const gate = holdAt("published");
		await using test = await household({ interleave: gate.interleave });
		const phone = await signedIn(test);
		const ana = test.contextOf(phone);
		orphan(test, JPEG, nightOf(1) - 2 * HOUR);
		test.clock.set(nightOf(1), { wake: false });
		const reusing = upload(phone);
		await gate.reaching;

		const cleaning = test.background.runDue();
		// The cleanup finds the file without a row and waits for its hash, which the upload holds.
		for (let turn = 0; turn < 20; turn += 1)
			await new Promise((resolve) => setTimeout(resolve, 1));
		gate.release();
		const prepared = (await (await reusing).json()) as { id: string };
		await cleaning;

		expect(lastRun(test)).toMatchObject({ task: "cleanup", result: "ok" });
		expect(stored(test)).toEqual([sha256(JPEG)]);
		const file = attach(test, ana, prepared.id);
		const response = await phone.fetch(
			new Request(new URL("/api/files/download", TEST_ORIGIN), {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ action: "probe.getNote", input: { id: 1 }, file }),
			}),
		);
		expect(sha256(new Uint8Array(await response.arrayBuffer()))).toBe(sha256(JPEG));
	});

	it("deletes one while an upload of its content is still arriving, which then writes its own", async () => {
		await using test = await household();
		const phone = await signedIn(test);
		orphan(test, JPEG, nightOf(1) - 2 * HOUR);
		test.clock.set(nightOf(1), { wake: false });
		const uploading = controlledUpload(phone, JPEG.length);
		uploading.send(JPEG.subarray(0, 4));
		await until(() => incoming(test).length === 1);

		await test.background.runDue();
		expect(lastRun(test)).toMatchObject({ task: "cleanup", result: "ok" });
		expect(stored(test)).toEqual([]);
		uploading.send(JPEG.subarray(4));
		uploading.end();

		expect((await uploading.response).status).toBe(200);
		expect(stored(test)).toEqual([sha256(JPEG)]);
	});
});

describe("the cleanup of the uploads", () => {
	it("leaves the temporary file of an upload in progress, and removes one no upload holds", async () => {
		await using test = await household();
		const phone = await signedIn(test);
		// At the night's instant before the upload starts: its minute without bytes is armed from there.
		test.clock.set(nightOf(0), { wake: false });
		const uploading = controlledUpload(phone, JPEG.length);
		uploading.send(JPEG.subarray(0, 4));
		await until(() => incoming(test).length === 1);
		const [inProgress] = incoming(test);
		writeFileSync(join(test.filesDirectory, "incoming", "left-by-a-failure"), "half");

		await test.background.runDue();

		expect(lastRun(test)).toMatchObject({ task: "cleanup", result: "ok" });
		expect(incoming(test)).toEqual([inProgress]);
		uploading.send(JPEG.subarray(4));
		uploading.end();
		expect((await uploading.response).status).toBe(200);
		expect(incoming(test)).toEqual([]);
	});
});

describe("deleting a content while it is used", () => {
	it("answers CONTENT_BUSY to an upload of a content being deleted, and leaves no temporary file", async () => {
		const gate = holdAt("claimed");
		await using test = await household({ interleave: gate.interleave });
		const phone = await signedIn(test);
		await prepare(phone);
		test.clock.set(nightOf(1));
		await gate.reaching;

		const busy = await upload(phone);

		expect(busy.status).toBe(503);
		expect(busy.headers.get("retry-after")).toBe("1");
		expect(await busy.json()).toMatchObject({ code: "CONTENT_BUSY" });
		expect(incoming(test)).toEqual([]);
		gate.release();
		await test.background.settled();
		expect(stored(test)).toEqual([]);
		await prepare(phone);
		expect(stored(test)).toEqual([sha256(JPEG)]);
	});

	it("keeps a content an upload prepares again while the cleanup waits for its hash", async () => {
		const gate = holdAt("published", 1);
		await using test = await household({ interleave: gate.interleave });
		const phone = await signedIn(test);
		const ana = test.contextOf(phone);
		await prepare(phone);
		// The first prepared file expired: nothing points to the content once the cleanup removes it.
		test.clock.set(nightOf(1), { wake: false });
		const again = upload(phone);
		await gate.reaching;

		const cleaning = test.background.runDue();
		// The cleanup finds the content and waits for its hash, which the upload holds.
		for (let turn = 0; turn < 20; turn += 1)
			await new Promise((resolve) => setTimeout(resolve, 1));
		gate.release();
		const prepared = (await (await again).json()) as { id: string };
		await cleaning;

		expect(lastRun(test)).toMatchObject({ task: "cleanup", result: "ok" });
		expect(stored(test)).toEqual([sha256(JPEG)]);
		const file = attach(test, ana, prepared.id);
		expect(test.invoke(ana, "probe.getNote", { id: 1 })?.files).toEqual([
			expect.objectContaining({ id: file }),
		]);
	});

	it("keeps a content whose deletion was undone before the cleanup", async () => {
		await using test = await household();
		const phone = await signedIn(test);
		const ana = test.contextOf(phone);
		attach(test, ana, await prepare(phone));
		const { entry } = write(test, ana, "probe.deleteNote", { id: 1 });
		test.undo(ana, entry, { idempotencyKey: "u1" });

		await cleanOn(test, 1);

		expect(stored(test)).toEqual([sha256(JPEG)]);
	});

	it("hangs nothing from a content the cleanup claimed: neither attaching its prepared file nor undoing", async () => {
		const gate = holdAt("claimed");
		await using test = await household({ interleave: gate.interleave });
		const phone = await signedIn(test);
		const ana = test.contextOf(phone);
		const prepared = await prepare(phone);
		test.invoke(ana, "probe.addNote", { body: "garaje" }, { idempotencyKey: "n2" });
		attach(test, ana, await prepare(phone, PNG));
		// Two contents: a prepared file that expires unused, and a photo of the first note, which is deleted.
		const { entry } = write(test, ana, "probe.deleteNote", { id: 1 });
		test.clock.set(nightOf(1));
		await gate.reaching;

		expect(() => attach(test, ana, prepared)).toThrow(
			expect.objectContaining({ code: "NOT_FOUND" }),
		);
		expect(() => test.undo(ana, entry, { idempotencyKey: "u1" })).toThrow(
			expect.objectContaining({ data: { reason: "expired" } }),
		);
		gate.release();
		await test.background.settled();

		expect(stored(test)).toEqual([]);
		expect(test.invoke(ana, "probe.listNotes", undefined)).toEqual([
			expect.objectContaining({ id: 2, files: [] }),
		]);
	});

	it("deletes the file of a download already under way, which still ends whole", async () => {
		const gate = holdAt("opened");
		await using test = await household({ interleave: gate.interleave });
		const phone = await signedIn(test);
		const ana = test.contextOf(phone);
		const file = attach(test, ana, await prepare(phone));
		const downloading = phone.fetch(
			new Request(new URL("/api/files/download", TEST_ORIGIN), {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ action: "probe.getNote", input: { id: 1 }, file }),
			}),
		);
		await gate.reaching;

		write(test, ana, "probe.detachFile", { noteId: 1, file });
		await cleanOn(test, 1);
		expect(stored(test)).toEqual([]);
		gate.release();
		const response = await downloading;

		expect(response.status).toBe(200);
		expect(sha256(new Uint8Array(await response.arrayBuffer()))).toBe(sha256(JPEG));
	});

	it("finishes in the next cleanup a content left claimed without its file, and then takes its upload again", async () => {
		const gate = holdAt("claimed");
		await using test = await household({ interleave: gate.interleave });
		const phone = await signedIn(test);
		await prepare(phone);
		test.clock.set(nightOf(1));
		await gate.reaching;
		const hash = sha256(JPEG);
		rmSync(join(test.filesDirectory, "contents", hash.slice(0, 2), hash));
		gate.release(new Error("cut after removing the file"));
		await test.background.settled();
		expect(lastRun(test)?.result).toBeNull();
		expect((await upload(phone)).status).toBe(503);

		// The failed run tries again 30 s later.
		test.clock.advance(30_000);
		await test.background.settled();
		expect(test.background.runs()).toEqual([
			expect.objectContaining({ task: "cleanup", result: "ok" }),
		]);

		expect(stored(test)).toEqual([]);
		await prepare(phone);
		expect(stored(test)).toEqual([hash]);
	});
});

// The limits of an upload (ADR 0028, spec of phase 1d3, «Subir» and «Reservas de espacio»): an upload reserves its
// declared size before its first byte, against its session and the free space of the volume, so uploading can
// neither fill the disk nor leave an upload hanging. The test controls the body, the free space and the clock.
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { TEST_ORIGIN, type TestBrowser } from "./index";
import { createTestPlatform, type TestPlatformOptions } from "./platform";

const PASSWORD = "correct horse battery staple";

const MB = 1024 * 1024;
const GB = 1024 * MB;

/** What the volume must keep free after every reservation. */
const KEPT_FREE = 2 * GB;

/** The start of a JPEG: enough for its signature. */
const JPEG = Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00);

/** The size of a small upload: a JPEG signature and a seed. */
const SMALL = JPEG.length + 4;

/** A JPEG of `size` bytes, different for each `seed`: its signature, then the seed, then zeros. */
function jpeg(size: number, seed = 0): Uint8Array<ArrayBuffer> {
	const bytes = new Uint8Array(size);
	bytes.set(JPEG);
	new DataView(bytes.buffer).setUint32(JPEG.length, seed);
	return bytes;
}

/** A platform without modules where Ana and Beto, members, have a password. */
async function household(options: Partial<TestPlatformOptions<[]>> = {}) {
	const test = createTestPlatform({ modules: [], ...options });
	for (const id of ["ana", "beto"]) {
		test.prepare.account({ id, role: "member" });
		await test.prepare.password(id, PASSWORD);
	}
	return test;
}

async function signedIn(test: { browser(): TestBrowser }, email: string): Promise<TestBrowser> {
	const browser = test.browser();
	expect((await browser.signIn(email, PASSWORD)).status).toBe(200);
	return browser;
}

/** Sends `bytes` whole to the upload route. */
function upload(browser: TestBrowser, bytes: Uint8Array<ArrayBuffer>): Promise<Response> {
	return browser.fetch(
		new Request(new URL("/api/files", TEST_ORIGIN), {
			method: "POST",
			body: bytes,
			headers: { "content-length": String(bytes.length), "x-file-name": "foto.jpg" },
		}),
	);
}

/** An upload whose body the test sends when it wants: chunks, its end, or a cut connection. */
interface ControlledUpload {
	readonly response: Promise<Response>;
	send(bytes: Uint8Array): void;
	end(): void;
	cut(): void;
}

/** Starts an upload that declares `size` bytes and sends none until the test says so. */
function startUpload(
	browser: TestBrowser,
	size: number,
	{ signal }: { readonly signal?: AbortSignal } = {},
): ControlledUpload {
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
			...(signal === undefined ? {} : { signal }),
		} as RequestInit),
	);
	return {
		response,
		send: (bytes) => controller.enqueue(bytes),
		end: () => controller.close(),
		cut: () => controller.error(new Error("the connection was cut")),
	};
}

/** The sizes of the temporary files of the uploads in progress, smallest first. */
function incoming(filesDirectory: string): number[] {
	const folder = join(filesDirectory, "incoming");
	if (!existsSync(folder)) return [];
	return readdirSync(folder)
		.map((name) => statSync(join(folder, name)).size)
		.sort((a, b) => a - b);
}

/** Every file under the store's contents. */
function storedContents(filesDirectory: string): number {
	const contents = join(filesDirectory, "contents");
	if (!existsSync(contents)) return 0;
	return readdirSync(contents, { recursive: true, withFileTypes: true }).filter((entry) =>
		entry.isFile(),
	).length;
}

/**
 * Waits until the uploads in progress hold exactly `sizes` bytes in their temporary files: then each has written
 * what it got and waits for more.
 */
async function receiving(filesDirectory: string, ...sizes: number[]): Promise<void> {
	const wanted = JSON.stringify([...sizes].sort((a, b) => a - b));
	for (let turn = 0; JSON.stringify(incoming(filesDirectory)) !== wanted; turn += 1) {
		if (turn > 2000)
			throw new Error(`uploads in progress hold ${String(incoming(filesDirectory))}`);
		await new Promise((resolve) => setTimeout(resolve, 1));
	}
}

async function codeOf(response: Response): Promise<{ status: number; code: unknown }> {
	const body = (await response.json()) as { code?: unknown };
	return { status: response.status, code: body.code };
}

describe("the limits of an upload", () => {
	it("reserves its declared size before the first byte, against the uploads of every session", async () => {
		const upload1 = MB;
		await using test = await household({ freeSpace: () => KEPT_FREE + upload1 });
		const ana = await signedIn(test, "ana@domus.test");
		const beto = await signedIn(test, "beto@domus.test");

		const first = startUpload(ana, upload1);
		await receiving(test.filesDirectory, 0);
		const second = await upload(beto, jpeg(SMALL));

		expect(await codeOf(second)).toEqual({ status: 507, code: "INSUFFICIENT_STORAGE" });
		first.send(jpeg(upload1));
		first.end();
		expect((await first.response).status).toBe(200);
		// Its reservation is gone with it, and what it stored is the volume's to measure.
		expect((await upload(beto, jpeg(SMALL))).status).toBe(200);
		expect(incoming(test.filesDirectory)).toEqual([]);
	});

	it("answers DISK_FULL when a write finds no space, freeing its temporary file and its reservation", async () => {
		let full = true;
		await using test = await household({
			// Room for one small upload only: a reservation left behind would refuse the next one.
			freeSpace: () => KEPT_FREE + SMALL,
			diskFull: () => full,
		});
		const ana = await signedIn(test, "ana@domus.test");

		const refused = await upload(ana, jpeg(SMALL));

		expect(await codeOf(refused)).toEqual({ status: 507, code: "DISK_FULL" });
		expect(incoming(test.filesDirectory)).toEqual([]);
		full = false;
		expect((await upload(ana, jpeg(SMALL))).status).toBe(200);
	});

	describe("refuses a body that is not as long as it declares, leaving nothing", () => {
		it.each([
			{ length: "shorter", sent: SMALL - 1 },
			{ length: "longer", sent: SMALL + 1 },
		])("$length: BODY_MISMATCH", async ({ sent }) => {
			await using test = await household({ freeSpace: () => KEPT_FREE + SMALL });
			const ana = await signedIn(test, "ana@domus.test");
			const mismatched = startUpload(ana, SMALL);

			mismatched.send(jpeg(SMALL + 1).subarray(0, sent));
			mismatched.end();

			expect(await codeOf(await mismatched.response)).toEqual({
				status: 400,
				code: "BODY_MISMATCH",
			});
			expect(incoming(test.filesDirectory)).toEqual([]);
			expect(storedContents(test.filesDirectory)).toBe(0);
			expect((await upload(ana, jpeg(SMALL))).status).toBe(200);
		});

		it("longer, without waiting for the end of what it sends", async () => {
			await using test = await household();
			const ana = await signedIn(test, "ana@domus.test");
			const endless = startUpload(ana, SMALL);

			endless.send(jpeg(SMALL + 1));

			expect(await codeOf(await endless.response)).toEqual({
				status: 400,
				code: "BODY_MISMATCH",
			});
			expect(incoming(test.filesDirectory)).toEqual([]);
		});
	});

	describe("gives up after a minute without bytes", () => {
		const MINUTE = 60 * 1000;

		it("before the first one: UPLOAD_TIMEOUT, its reservation freed", async () => {
			await using test = await household({ freeSpace: () => KEPT_FREE + SMALL });
			const ana = await signedIn(test, "ana@domus.test");
			const silent = startUpload(ana, SMALL);
			await receiving(test.filesDirectory, 0);

			test.clock.advance(MINUTE);

			expect(await codeOf(await silent.response)).toEqual({
				status: 408,
				code: "UPLOAD_TIMEOUT",
			});
			expect(incoming(test.filesDirectory)).toEqual([]);
			expect((await upload(ana, jpeg(SMALL))).status).toBe(200);
		});

		it("after part of them: UPLOAD_TIMEOUT", async () => {
			await using test = await household();
			const ana = await signedIn(test, "ana@domus.test");
			const stalled = startUpload(ana, SMALL);
			stalled.send(jpeg(SMALL).subarray(0, 4));
			await receiving(test.filesDirectory, 4);

			test.clock.advance(MINUTE);

			expect(await codeOf(await stalled.response)).toEqual({
				status: 408,
				code: "UPLOAD_TIMEOUT",
			});
			expect(incoming(test.filesDirectory)).toEqual([]);
		});

		it("but not after 59 s, at the start or between two chunks", async () => {
			await using test = await household();
			const ana = await signedIn(test, "ana@domus.test");
			const slow = startUpload(ana, SMALL);
			const bytes = jpeg(SMALL);
			await receiving(test.filesDirectory, 0);

			test.clock.advance(MINUTE - 1000);
			slow.send(bytes.subarray(0, 4));
			await receiving(test.filesDirectory, 4);
			test.clock.advance(MINUTE - 1000);
			slow.send(bytes.subarray(4));
			slow.end();

			expect((await slow.response).status).toBe(200);
		});
	});

	describe("ends with what stops it during the receipt, its reservation freed and nothing left", () => {
		it("the client cancelling it", async () => {
			await using test = await household({ freeSpace: () => KEPT_FREE + SMALL });
			const ana = await signedIn(test, "ana@domus.test");
			const client = new AbortController();
			const cancelled = startUpload(ana, SMALL, { signal: client.signal });
			cancelled.send(jpeg(SMALL).subarray(0, 4));
			await receiving(test.filesDirectory, 4);

			client.abort();
			await cancelled.response;

			expect(incoming(test.filesDirectory)).toEqual([]);
			expect(storedContents(test.filesDirectory)).toBe(0);
			expect((await upload(ana, jpeg(SMALL))).status).toBe(200);
		});

		it("the connection cut", async () => {
			await using test = await household({ freeSpace: () => KEPT_FREE + SMALL });
			const ana = await signedIn(test, "ana@domus.test");
			const cut = startUpload(ana, SMALL);
			cut.send(jpeg(SMALL).subarray(0, 4));
			await receiving(test.filesDirectory, 4);

			cut.cut();
			await cut.response;

			expect(incoming(test.filesDirectory)).toEqual([]);
			expect(storedContents(test.filesDirectory)).toBe(0);
			expect((await upload(ana, jpeg(SMALL))).status).toBe(200);
		});

		it("its session revoked: UNAUTHORIZED at its next bytes", async () => {
			await using test = await household({ freeSpace: () => KEPT_FREE + SMALL });
			const phone = await signedIn(test, "ana@domus.test");
			const laptop = await signedIn(test, "ana@domus.test");
			const revoked = startUpload(phone, SMALL);
			const bytes = jpeg(SMALL);
			revoked.send(bytes.subarray(0, 4));
			await receiving(test.filesDirectory, 4);

			expect((await phone.signOut()).status).toBe(200);
			revoked.send(bytes.subarray(4, 8));

			expect(await codeOf(await revoked.response)).toEqual({
				status: 401,
				code: "UNAUTHORIZED",
			});
			expect(incoming(test.filesDirectory)).toEqual([]);
			expect(storedContents(test.filesDirectory)).toBe(0);
			expect((await upload(laptop, jpeg(SMALL))).status).toBe(200);
		});
	});

	describe("of a session", () => {
		/** Room enough on the volume for anything a session may hold. */
		const ROOMY = () => 100 * GB;

		it("holds 20 files at most, and a prepared file that expires gives its place back", async () => {
			await using test = await household({ freeSpace: ROOMY });
			const phone = await signedIn(test, "ana@domus.test");
			const laptop = await signedIn(test, "ana@domus.test");
			for (let seed = 0; seed < 20; seed += 1)
				expect((await upload(phone, jpeg(SMALL, seed))).status).toBe(200);

			const over = await upload(phone, jpeg(SMALL, 20));

			expect(await codeOf(over)).toEqual({ status: 429, code: "UPLOAD_LIMIT" });
			// Another session of the same person has its own limit.
			expect((await upload(laptop, jpeg(SMALL, 21))).status).toBe(200);
			test.clock.advance(24 * 60 * 60 * 1000);
			expect((await upload(phone, jpeg(SMALL, 20))).status).toBe(200);
		});

		it("holds 200 MB at most, counting its uploads in progress and its prepared files", async () => {
			await using test = await household({ freeSpace: ROOMY });
			const ana = await signedIn(test, "ana@domus.test");
			const largest = 25 * MB;
			expect((await upload(ana, jpeg(largest))).status).toBe(200);
			const inProgress = Array.from({ length: 7 }, () => startUpload(ana, largest));
			await receiving(test.filesDirectory, ...inProgress.map(() => 0));

			const over = await upload(ana, jpeg(SMALL));

			expect(await codeOf(over)).toEqual({ status: 429, code: "UPLOAD_LIMIT" });
			const [cut] = inProgress;
			cut?.cut();
			await cut?.response;
			expect((await upload(ana, jpeg(SMALL))).status).toBe(200);
			for (const other of inProgress.slice(1)) other.cut();
			await Promise.all(inProgress.map(({ response }) => response));
		});

		it("holds 20 files at most among its uploads in progress", async () => {
			await using test = await household({ freeSpace: ROOMY });
			const ana = await signedIn(test, "ana@domus.test");
			const inProgress = Array.from({ length: 20 }, () => startUpload(ana, SMALL));
			await receiving(test.filesDirectory, ...inProgress.map(() => 0));

			const over = await upload(ana, jpeg(SMALL));

			expect(await codeOf(over)).toEqual({ status: 429, code: "UPLOAD_LIMIT" });
			for (const [seed, each] of inProgress.entries()) {
				each.send(jpeg(SMALL, seed));
				each.end();
			}
			expect(
				(await Promise.all(inProgress.map(({ response }) => response))).map(
					({ status }) => status,
				),
			).toEqual(inProgress.map(() => 200));
		});
	});
});

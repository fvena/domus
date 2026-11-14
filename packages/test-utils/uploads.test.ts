// Uploading a file through the door (ADR 0028, spec of phase 1d3, «Subir» and «Publicar sin perder bytes»): a
// person's session sends the bytes to `POST /api/files` and gets a prepared file back, its content published in
// the store by its hash.
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { contentPath, TEST_ORIGIN, TEST_START, type TestBrowser } from "./index";
import { createTestPlatform, type TestPlatformOptions } from "./platform";

const PASSWORD = "correct horse battery staple";

const DAY = 24 * 60 * 60 * 1000;

/** The start of a JPEG and a few bytes of it: enough for its signature. */
const JPEG = Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00);

/** A platform without modules where Ana, a member, has a password. */
async function household(options: Partial<TestPlatformOptions<[]>> = {}) {
	const test = createTestPlatform({ modules: [], ...options });
	test.prepare.account({ id: "ana", role: "member" });
	await test.prepare.password("ana", PASSWORD);
	return test;
}

async function signedIn(test: { browser(): TestBrowser }, email: string): Promise<TestBrowser> {
	const browser = test.browser();
	expect((await browser.signIn(email, PASSWORD)).status).toBe(200);
	return browser;
}

/** Sends `bytes` to the upload route, its length and name in their headers unless told otherwise. */
function upload(
	browser: TestBrowser,
	bytes: Uint8Array<ArrayBuffer>,
	{ name = "foto.jpg" }: { readonly name?: string } = {},
): Promise<Response> {
	return browser.fetch(
		new Request(new URL("/api/files", TEST_ORIGIN), {
			method: "POST",
			body: bytes,
			headers: {
				"content-length": String(bytes.length),
				"x-file-name": encodeURIComponent(name),
			},
		}),
	);
}

function sha256(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

/** Every file under the store's contents, by its path inside it. */
function storedContents(filesDirectory: string): string[] {
	const contents = join(filesDirectory, "contents");
	if (!existsSync(contents)) return [];
	return readdirSync(contents, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile())
		.map((entry) => join(entry.parentPath, entry.name).slice(contents.length + 1))
		.sort();
}

/** A temporary folder of the test, removed when disposed. */
function temporaryFolder(): { readonly path: string } & AsyncDisposable {
	const path = mkdtempSync(join(tmpdir(), "domus-uploads-"));
	return {
		path,
		[Symbol.asyncDispose]: async () => {
			rmSync(path, { recursive: true, force: true });
		},
	};
}

/** What is left among the uploads in progress. */
function incoming(filesDirectory: string): string[] {
	const folder = join(filesDirectory, "incoming");
	return existsSync(folder) ? readdirSync(folder) : [];
}

describe("uploading a file", () => {
	it("prepares a JPEG a person's session uploads, its bytes in the store by their hash", async () => {
		await using test = await household();
		const browser = await signedIn(test, "ana@domus.test");

		const response = await upload(browser, JPEG, { name: "nevera rota.jpg" });

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			id: expect.any(String),
			name: "nevera rota.jpg",
			type: "image/jpeg",
			size: JPEG.length,
			expiresAt: TEST_START + DAY,
		});
		const hash = sha256(JPEG);
		expect(storedContents(test.filesDirectory)).toEqual([`${hash.slice(0, 2)}/${hash}`]);
		expect(readFileSync(contentPath(test.filesDirectory, hash))).toEqual(Buffer.from(JPEG));
		expect(incoming(test.filesDirectory)).toEqual([]);
	});

	it("answers UNAUTHORIZED without a session and FORBIDDEN to the device account, leaving nothing", async () => {
		await using test = await household();
		await test.prepare.password(test.deviceAccount, PASSWORD);
		const kitchen = await signedIn(test, "device@domus.invalid");

		const anonymous = await upload(test.browser(), JPEG);
		const device = await upload(kitchen, JPEG);

		expect(anonymous.status).toBe(401);
		expect(await anonymous.json()).toEqual({
			defined: false,
			code: "UNAUTHORIZED",
			status: 401,
			message: "Unauthorized",
		});
		expect(device.status).toBe(403);
		expect(await device.json()).toMatchObject({ code: "FORBIDDEN", status: 403 });
		expect(storedContents(test.filesDirectory)).toEqual([]);
		expect(incoming(test.filesDirectory)).toEqual([]);
	});

	it("shares one file between two uploads of the same content, each its own prepared file", async () => {
		await using test = await household();
		const browser = await signedIn(test, "ana@domus.test");

		const first = (await (await upload(browser, JPEG, { name: "a.jpg" })).json()) as {
			id: string;
		};
		const second = (await (await upload(browser, JPEG, { name: "b.jpg" })).json()) as {
			id: string;
			name: string;
		};

		expect(second.id).not.toBe(first.id);
		expect(second.name).toBe("b.jpg");
		expect(storedContents(test.filesDirectory)).toHaveLength(1);
		expect(incoming(test.filesDirectory)).toEqual([]);
	});

	it("publishes two simultaneous uploads of one content one after the other, under the lock of its hash", async () => {
		let held = 0;
		let release!: () => void;
		const releasing = new Promise<void>((resolve) => {
			release = resolve;
		});
		let reached!: () => void;
		const reaching = new Promise<void>((resolve) => {
			reached = resolve;
		});
		await using test = await household({
			// The first publication stops with its file in place and its rows not yet written; signing in goes on.
			interleave: (point) => {
				if (point === "entering") return undefined;
				expect(point).toBe("published");
				held += 1;
				if (held > 1) return undefined;
				reached();
				return releasing;
			},
		});
		const phone = await signedIn(test, "ana@domus.test");
		const laptop = await signedIn(test, "ana@domus.test");

		const first = upload(phone, JPEG);
		await reaching;
		const second = upload(laptop, JPEG);
		// The second one gets its bytes, but waits for the hash while the first holds it: without the lock it would
		// reach the point within these few milliseconds.
		for (let turn = 0; turn < 20 && held === 1; turn += 1)
			await new Promise((resolve) => setTimeout(resolve, 1));
		expect(held).toBe(1);
		release();
		const answers = await Promise.all([first, second]);

		expect(answers.map(({ status }) => status)).toEqual([200, 200]);
		const [a, b] = (await Promise.all(answers.map((answer) => answer.json()))) as {
			id: string;
		}[];
		expect(a?.id).not.toBe(b?.id);
		expect(held).toBe(2);
		expect(storedContents(test.filesDirectory)).toHaveLength(1);
		expect(incoming(test.filesDirectory)).toEqual([]);
	});

	it("prepares a file until its session expires on the platform's clock, and answers UNAUTHORIZED after", async () => {
		await using test = await household();
		const browser = await signedIn(test, "ana@domus.test");
		const expiresAt = test.sessionExpiresAt(test.contextOf(browser).session ?? "") ?? 0;

		test.clock.set(expiresAt - 1);
		expect((await upload(browser, JPEG)).status).toBe(200);

		test.clock.set(expiresAt);
		const response = await upload(browser, Uint8Array.of(...JPEG, 1));
		expect(response.status).toBe(401);
		expect(await response.json()).toMatchObject({ code: "UNAUTHORIZED" });
		expect(incoming(test.filesDirectory)).toEqual([]);
	});

	it("answers UNAUTHORIZED to a session that ended before the rows, and prepares nothing", async () => {
		let reached!: () => void;
		const reaching = new Promise<void>((resolve) => {
			reached = resolve;
		});
		let release!: () => void;
		const releasing = new Promise<void>((resolve) => {
			release = resolve;
		});
		await using test = await household({
			interleave: (point) => {
				if (point !== "published") return undefined;
				reached();
				return releasing;
			},
		});
		const browser = await signedIn(test, "ana@domus.test");
		const other = await signedIn(test, "ana@domus.test");

		const uploading = upload(browser, JPEG);
		await reaching;
		expect((await browser.signOut()).status).toBe(200);
		release();
		const response = await uploading;

		expect(response.status).toBe(401);
		expect(await response.json()).toMatchObject({ code: "UNAUTHORIZED" });
		// The same bytes from a live session are prepared, reusing the file the ended one left without a row.
		const again = await upload(other, JPEG);
		expect(again.status).toBe(200);
		expect(incoming(test.filesDirectory)).toEqual([]);
	});

	describe("the folder of contents", () => {
		it("loses what an earlier process left half uploaded before the door admits a request", async () => {
			await using folder = temporaryFolder();
			const files = join(folder.path, "files");
			mkdirSync(join(files, "incoming", "nested"), { recursive: true });
			writeFileSync(join(files, "incoming", "left-by-a-cut"), "half");

			await using test = await household({ files });

			expect(test.filesDirectory).toBe(files);
			expect(incoming(files)).toEqual([]);
		});

		it("of the harness goes on close, and the test's own stays for opening it again", async () => {
			await using folder = temporaryFolder();
			const files = join(folder.path, "files");
			const own = await household({ files });
			const harness = await household();
			for (const test of [own, harness])
				expect((await upload(await signedIn(test, "ana@domus.test"), JPEG)).status).toBe(
					200,
				);

			own.close();
			harness.close();

			expect(existsSync(harness.filesDirectory)).toBe(false);
			expect(storedContents(files)).toHaveLength(1);
		});

		it("of the harness goes on close once the uploads in progress are cancelled", async () => {
			const test = await household();
			const browser = await signedIn(test, "ana@domus.test");
			// A body that sends its first bytes and then nothing more.
			const body = new ReadableStream<Uint8Array>({
				start: (controller) => controller.enqueue(JPEG),
			});
			const uploading = browser.fetch(
				new Request(new URL("/api/files", TEST_ORIGIN), {
					method: "POST",
					body,
					duplex: "half",
					headers: { "content-length": "100", "x-file-name": "foto.jpg" },
				} as RequestInit),
			);
			while (incoming(test.filesDirectory).length === 0)
				await new Promise((resolve) => setTimeout(resolve, 1));

			test.close();
			const response = await uploading;

			expect(response.status).toBe(500);
			expect(existsSync(test.filesDirectory)).toBe(false);
		});
	});

	describe("refuses with the code and status of its cause, leaving nothing behind", () => {
		const PDF = new TextEncoder().encode("%PDF-1.7\n%âãÏÓ\n");
		const cases: readonly {
			readonly cause: string;
			readonly bytes: Uint8Array<ArrayBuffer>;
			readonly headers: Readonly<Record<string, string | undefined>>;
			readonly code: string;
			readonly status: number;
		}[] = [
			{
				cause: "without Content-Length",
				bytes: JPEG,
				headers: { "content-length": undefined },
				code: "LENGTH_REQUIRED",
				status: 411,
			},
			{
				cause: "with a Content-Length that is not a number",
				bytes: JPEG,
				headers: { "content-length": "eleven" },
				code: "LENGTH_REQUIRED",
				status: 411,
			},
			{
				cause: "with Content-Length 0",
				bytes: new Uint8Array(0),
				headers: {},
				code: "FILE_EMPTY",
				status: 400,
			},
			{
				cause: "with a Content-Length over 25 MB",
				bytes: JPEG,
				headers: { "content-length": String(25 * 1024 * 1024 + 1) },
				code: "FILE_TOO_LARGE",
				status: 413,
			},
			{
				cause: "without a name",
				bytes: JPEG,
				headers: { "x-file-name": undefined },
				code: "INVALID_FILE_NAME",
				status: 400,
			},
			{
				cause: "with a name that is a path",
				bytes: JPEG,
				headers: { "x-file-name": encodeURIComponent("../foto.jpg") },
				code: "INVALID_FILE_NAME",
				status: 400,
			},
			{
				cause: "with a type it does not accept",
				bytes: Uint8Array.of(0x4d, 0x5a, 0x90, 0x00, 0x03),
				headers: { "x-file-name": "programa.exe" },
				code: "FILE_TYPE_NOT_ALLOWED",
				status: 415,
			},
			{
				cause: "with a header it does not recognize",
				bytes: PDF.subarray(0, 6),
				headers: { "x-file-name": "factura.pdf" },
				code: "FILE_TYPE_NOT_ALLOWED",
				status: 415,
			},
		];

		it.each(cases)("$cause: $code", async ({ bytes, headers, code, status }) => {
			await using test = await household();
			const browser = await signedIn(test, "ana@domus.test");
			const sent = new Headers({
				"content-length": String(bytes.length),
				"x-file-name": "foto.jpg",
			});
			for (const [name, value] of Object.entries(headers))
				if (value === undefined) sent.delete(name);
				else sent.set(name, value);

			const response = await browser.fetch(
				new Request(new URL("/api/files", TEST_ORIGIN), {
					method: "POST",
					body: bytes,
					headers: sent,
				}),
			);

			expect(response.status).toBe(status);
			expect(await response.json()).toMatchObject({ defined: false, code, status });
			expect(storedContents(test.filesDirectory)).toEqual([]);
			expect(incoming(test.filesDirectory)).toEqual([]);
		});
	});
});

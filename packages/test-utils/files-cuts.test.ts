// Power cuts while publishing or deleting a content (ADR 0028, spec of phase 1d3, «Publicar sin perder bytes»,
// «Limpieza» and seam 4 of «Decisiones de prueba»): a child process is killed at each cut point, and the platform
// opened again over the same data never has a present content without its file; what the cut left half done, the
// cleanup collects or an upload reuses.
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { contentPath, startChild } from "@domus/platform/testing";
import { describe, expect, it } from "vitest";

import { TEST_ORIGIN, TEST_START, type TestBrowser } from "./index";
import { createTestPlatform } from "./platform";

const PASSWORD = "correct horse battery staple";

const DAY = 24 * 60 * 60 * 1000;

/** Room enough on the volume for every upload of these tests, whatever the machine has free. */
const ROOMY = () => 100 * 1024 * 1024 * 1024;

/** The start of a JPEG and a few bytes of it: enough for its signature. */
const JPEG = Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00);

const HASH = createHash("sha256").update(JPEG).digest("hex");

/** 04:30 in Madrid (CET, +01:00) on day `day` after the test's start: when the cleanup of that night runs. */
function nightOf(day: number): number {
	return TEST_START + day * DAY + 3.5 * 60 * 60 * 1000;
}

/** A data folder of the test, with the database and the store, removed when disposed. */
function dataFolder(): { readonly path: string } & AsyncDisposable {
	const path = mkdtempSync(join(tmpdir(), "domus-cuts-"));
	return {
		path,
		[Symbol.asyncDispose]: async () => {
			rmSync(path, { recursive: true, force: true });
		},
	};
}

/** The platform over a data folder, without modules, where Ana, a member, has a password once `ready`. */
function openOver(dataDirectory: string) {
	return createTestPlatform({
		modules: [],
		file: join(dataDirectory, "domus.db"),
		files: join(dataDirectory, "files"),
		freeSpace: ROOMY,
	});
}

async function household(dataDirectory: string) {
	const test = openOver(dataDirectory);
	test.prepare.account({ id: "ana", role: "member" });
	await test.prepare.password("ana", PASSWORD);
	return test;
}

async function signedIn(test: { browser(): TestBrowser }): Promise<TestBrowser> {
	const browser = test.browser();
	expect((await browser.signIn("ana@domus.test", PASSWORD)).status).toBe(200);
	return browser;
}

function upload(browser: TestBrowser): Promise<Response> {
	return browser.fetch(
		new Request(new URL("/api/files", TEST_ORIGIN), {
			method: "POST",
			body: JPEG,
			headers: { "content-length": String(JPEG.length), "x-file-name": "foto.jpg" },
		}),
	);
}

/** Every file under the store's contents, by its name. */
function stored(dataDirectory: string): string[] {
	const contents = join(dataDirectory, "files", "contents");
	if (!existsSync(contents)) return [];
	return readdirSync(contents, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile())
		.map((entry) => entry.name)
		.sort();
}

/** Runs the cleanup of night `day` and expects it to end well. */
async function cleanOn(test: ReturnType<typeof openOver>, day: number): Promise<void> {
	test.background.start();
	test.clock.set(nightOf(day));
	await test.background.settled();
	expect(test.background.runs().slice(-1)[0]).toMatchObject({ task: "cleanup", result: "ok" });
}

/** A child publishes the JPEG for Ana and is killed once its file is in place, before its rows. */
async function cutWhilePublishing(dataDirectory: string): Promise<void> {
	const before = await household(dataDirectory);
	const { session } = before.prepare.session("ana");
	before.close();
	const child = await startChild({
		hold: "publish",
		dataDirectory,
		account: "ana",
		session,
		content: Buffer.from(JPEG).toString("base64"),
	});
	await child.kill();
}

describe("a cut while publishing, after the rename and before the rows", () => {
	it("leaves the file without a row, which an upload of the same content reuses", async () => {
		await using folder = dataFolder();
		await cutWhilePublishing(folder.path);

		await using test = openOver(folder.path);
		expect(stored(folder.path)).toEqual([HASH]);
		const response = await upload(await signedIn(test));

		expect(response.status).toBe(200);
		expect(stored(folder.path)).toEqual([HASH]);
	});

	it("leaves the file without a row, which the cleanup collects an hour later", async () => {
		await using folder = dataFolder();
		await cutWhilePublishing(folder.path);
		const path = contentPath(join(folder.path, "files"), HASH);
		// Left by a cut at the start of the test's day, more than an hour before its night.
		utimesSync(path, new Date(TEST_START), new Date(TEST_START));

		await using test = openOver(folder.path);
		await cleanOn(test, 1);

		expect(stored(folder.path)).toEqual([]);
		expect((await upload(await signedIn(test))).status).toBe(200);
		expect(stored(folder.path)).toEqual([HASH]);
	});
});

describe("a cut while deleting a content", () => {
	it.each([
		{ at: "claimed", left: [HASH] },
		{ at: "removed", left: [] },
	] as const)(
		"after $at leaves it claimed, and the next cleanup ends the deletion and takes its upload again",
		async ({ at, left }) => {
			await using folder = dataFolder();
			// A prepared file that expires unused: the cleanup of the first night deletes its content.
			const before = await household(folder.path);
			expect((await upload(await signedIn(before))).status).toBe(200);
			before.close();
			const child = await startChild({
				hold: "delete",
				dataDirectory: folder.path,
				now: nightOf(1),
				at,
			});
			await child.kill();

			await using test = openOver(folder.path);
			const phone = await signedIn(test);
			expect(stored(folder.path)).toEqual(left);
			const busy = await upload(phone);
			expect(busy.status).toBe(503);
			expect(await busy.json()).toMatchObject({ code: "CONTENT_BUSY" });

			await cleanOn(test, 1);
			expect(stored(folder.path)).toEqual([]);
			expect((await upload(phone)).status).toBe(200);
			expect(stored(folder.path)).toEqual([HASH]);
		},
	);
});

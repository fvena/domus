// No answer of the API is kept in a cache (spec of phase 1d4, «`no-store`»): every response under `/api/*`, a good
// one and an error, of the platform's RPC, a module's action, the routes of files and Better Auth's, carries
// `Cache-Control: no-store`. `/health` stays as it was.
import { createTestPlatform, TEST_ORIGIN, type TestBrowser } from "@domus/test-utils";
import { describe, expect, it } from "vitest";

import probe from "../server";

const PASSWORD = "correct horse battery staple";

/** Room enough on the volume for the upload of these tests, whatever the machine has free. */
const ROOMY = () => 100 * 1024 * 1024 * 1024;

/** The start of a JPEG: enough for its signature. */
const JPEG = Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00);

/** A platform with probe where Ana, a member, has a password and a note. */
async function household() {
	const test = createTestPlatform({ modules: [probe], freeSpace: ROOMY });
	test.prepare.account({ id: "ana", role: "member" });
	await test.prepare.password("ana", PASSWORD);
	test.invoke(test.context("ana"), "probe.addNote", { body: "nevera" }, { idempotencyKey: "n1" });
	return test;
}

function post(browser: TestBrowser, path: string, init: RequestInit = {}): Promise<Response> {
	return browser.fetch(new Request(new URL(path, TEST_ORIGIN), { method: "POST", ...init }));
}

function rpc(
	browser: TestBrowser,
	path: string,
	input: unknown,
	headers: Readonly<Record<string, string>> = {},
) {
	return post(browser, `/api/rpc/${path}`, {
		headers: { "content-type": "application/json", ...headers },
		body: JSON.stringify({ json: input }),
	});
}

function upload(browser: TestBrowser): Promise<Response> {
	return post(browser, "/api/files", {
		body: JPEG,
		headers: { "content-length": String(JPEG.length), "x-file-name": "nevera.jpg" },
	});
}

function download(browser: TestBrowser, file: string): Promise<Response> {
	return post(browser, "/api/files/download", {
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ action: "probe.getNote", input: { id: 1 }, file }),
	});
}

/** The status and the cache rule of a response. */
function cached(response: Response) {
	return { status: response.status, cacheControl: response.headers.get("cache-control") };
}

const noStore = (status: number) => ({ status, cacheControl: "no-store" });

describe("no-store", () => {
	it("marks a good answer and an error of every family of routes under /api", async () => {
		await using test = await household();
		const stranger = test.browser();
		const phone = test.browser();

		expect(cached(await stranger.signIn("ana@domus.test", "a wrong passphrase"))).toEqual(
			noStore(401),
		);
		expect(cached(await phone.signIn("ana@domus.test", PASSWORD))).toEqual(noStore(200));

		expect(cached(await rpc(stranger, "sessions/list", undefined))).toEqual(noStore(401));
		expect(cached(await rpc(phone, "sessions/list", undefined))).toEqual(noStore(200));

		expect(cached(await rpc(stranger, "probe/listNotes", undefined))).toEqual(noStore(401));
		expect(
			cached(await rpc(phone, "probe/addNote", { body: "pan" }, { "idempotency-key": "k1" })),
		).toEqual(noStore(200));

		expect(cached(await upload(stranger))).toEqual(noStore(401));
		const uploaded = await upload(phone);
		expect(cached(uploaded)).toEqual(noStore(200));

		const prepared = ((await uploaded.json()) as { id: string }).id;
		const attached = test.invoke(
			test.contextOf(phone),
			"probe.attachFile",
			{ noteId: 1, prepared },
			{ idempotencyKey: "a1" },
		);
		if ("repeated" in attached) throw new Error("attached before");
		expect(cached(await download(stranger, attached.result.id))).toEqual(noStore(401));
		expect(cached(await download(phone, attached.result.id))).toEqual(noStore(200));

		expect(cached(await post(phone, "/api/nothing"))).toEqual(noStore(404));
		expect(cached(await phone.signOut())).toEqual(noStore(200));
	});

	it("leaves /health as it was", async () => {
		await using test = await household();

		const response = await test.door.fetch(new Request(new URL("/health", TEST_ORIGIN)));

		expect(cached(response)).toEqual({ status: 200, cacheControl: null });
	});
});

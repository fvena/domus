// The keys of the connected apps at the door (ADR 0030): a good key makes `status` say which app calls, a bad
// credential never falls back to anonymous, and outside `status` a key opens nothing yet. Kira's calls go through
// the same `clientFor` and `fetch` as `assistant`, straight to the door, without the cookies of a test browser.
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { clientFor } from "@domus/api-client";
import {
	createTestPlatform,
	PROTOCOL,
	platformContract,
	TEST_ORIGIN,
	type TestBrowser,
} from "@domus/test-utils";
import { describe, expect, it } from "vitest";

import { probeContract } from "../contracts";
import probe from "../server";

const PASSWORD = "correct horse battery staple";
const SESSION_COOKIE = "better-auth.session_token";
const DEVICE_COOKIE = "domus.device";

/** Something with a `fetch` of the door: the door itself, or a test browser with its cookies. */
interface Fetcher {
	readonly fetch: (request: Request) => Promise<Response>;
}

/** The platform's client on the door, sending `headers` as `assistant` would. */
function appClient(test: { readonly door: Fetcher }, headers = {}) {
	return clientFor(platformContract, { baseUrl: TEST_ORIGIN, fetch: test.door.fetch, headers });
}

/** The platform's client on a test browser's fetch, so its cookies travel with `headers`. */
function browserClient(browser: Fetcher, headers = {}) {
	return clientFor(platformContract, { baseUrl: TEST_ORIGIN, fetch: browser.fetch, headers });
}

/** A platform with probe and Ana, a member with a password. */
async function probeWithAna(options: { readonly apps?: readonly string[] } = {}) {
	const test = createTestPlatform({ modules: [probe], ...options });
	test.prepare.account({ id: "ana", role: "member" });
	await test.prepare.password("ana", PASSWORD);
	return test;
}

/** The `Authorization` of a key. */
const bearer = (key: string) => ({ authorization: `Bearer ${key}` });

/** The public id of a key, `domus_<id>.<secret>`. */
const idOf = (key: string) => key.slice("domus_".length, key.indexOf("."));

/** The secret of a key. */
const secretOf = (key: string) => key.slice(key.indexOf(".") + 1);

/** A key of the agreed form that nobody created, built at run time: a literal one would stop the commit. */
const unknownKey = () =>
	`domus_${randomBytes(8).toString("base64url")}.${randomBytes(32).toString("base64url")}`;

/** A browser whose every request also carries `headers`, keeping the text of every answer it got. */
function carrying(browser: TestBrowser, headers: Record<string, string>) {
	const answers: string[] = [];
	const fetch = async (request: Request) => {
		const sent = new Headers(request.headers);
		for (const [name, value] of Object.entries(headers)) sent.set(name, value);
		const response = await browser.fetch(new Request(request, { headers: sent }));
		answers.push(await response.clone().text());
		return response;
	};
	return { fetch, answers };
}

/** A request to a route of Hono at `path`, with a JSON body when given. */
function route(path: string, method = "GET", body?: unknown): Request {
	return new Request(new URL(path, TEST_ORIGIN), {
		method,
		...(body === undefined
			? {}
			: { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
	});
}

describe("keys at the door", () => {
	it("opens no platform with a test app named as another app", () => {
		expect(() => createTestPlatform({ modules: [probe], apps: ["kira"] })).toThrow(
			'connected app "kira" is listed twice',
		);
		expect(() => createTestPlatform({ modules: [probe], apps: ["tester", "tester"] })).toThrow(
			'connected app "tester" is listed twice',
		);
	});

	describe("status", () => {
		it("answers as before without a credential", async () => {
			await using test = createTestPlatform({ modules: [probe] });

			expect(await appClient(test).status()).toEqual({
				service: "domus",
				protocol: PROTOCOL,
			});
		});

		it("says which app calls with a good key: kira, or a test app", async () => {
			await using test = createTestPlatform({ modules: [probe], apps: ["tester"] });

			expect(await appClient(test, bearer(test.prepare.key("kira"))).status()).toEqual({
				service: "domus",
				protocol: PROTOCOL,
				app: "kira",
			});
			expect(await appClient(test, bearer(test.prepare.key("tester"))).status()).toEqual({
				service: "domus",
				protocol: PROTOCOL,
				app: "tester",
			});
		});

		it("answers unauthorized to every bad key, never as if it had none", async () => {
			await using test = createTestPlatform({ modules: [probe] });
			const key = test.prepare.key("kira");
			const other = test.prepare.key("kira");
			const revoked = test.prepare.key("kira");
			test.revokeKey(idOf(revoked));

			for (const authorization of [
				"Bearer",
				"Bearer ",
				"",
				`Bearer ${key}x`,
				`Bearer ${key.toUpperCase()}`,
				`Bearer ${unknownKey()}`,
				`Bearer ${revoked}`,
				`Bearer domus_${idOf(key)}.${secretOf(other)}`,
				`Basic ${key}`,
				key,
			])
				await expect(appClient(test, { authorization }).status()).rejects.toMatchObject({
					code: "UNAUTHORIZED",
				});
			expect(await appClient(test, bearer(other)).status()).toMatchObject({ app: "kira" });
		});

		it("answers unauthorized to a key next to the session cookie, also with a session that lives", async () => {
			await using test = await probeWithAna();
			const key = test.prepare.key("kira");
			const browser = test.browser();
			expect((await browser.signIn("ana@domus.test", PASSWORD)).status).toBe(200);

			await expect(browserClient(browser, bearer(key)).status()).rejects.toMatchObject({
				code: "UNAUTHORIZED",
			});
			browser.setCookie(SESSION_COOKIE, "a-session-nobody-signed");
			await expect(browserClient(browser, bearer(key)).status()).rejects.toMatchObject({
				code: "UNAUTHORIZED",
			});
		});

		it("takes the key alone next to the device cookie and any other", async () => {
			await using test = await probeWithAna();
			const key = test.prepare.key("kira");
			const browser = test.browser();
			await browser.signIn("ana@domus.test", PASSWORD);
			await browser.signOut();
			expect(browser.cookie(DEVICE_COOKIE)).toBeDefined();
			browser.setCookie("theme", "dark");

			expect(await browserClient(browser, bearer(key)).status()).toMatchObject({
				app: "kira",
			});
		});

		it("answers unauthorized to a key of an app no longer in the list", async () => {
			const folder = mkdtempSync(join(tmpdir(), "domus-keys-"));
			try {
				const file = join(folder, "domus.db");
				let key: string;
				{
					await using test = createTestPlatform({
						modules: [probe],
						file,
						apps: ["tester"],
					});
					key = test.prepare.key("tester");
					expect(await appClient(test, bearer(key)).status()).toMatchObject({
						app: "tester",
					});
				}
				await using test = createTestPlatform({ modules: [probe], file });
				await expect(appClient(test, bearer(key)).status()).rejects.toMatchObject({
					code: "UNAUTHORIZED",
				});
			} finally {
				rmSync(folder, { recursive: true, force: true });
			}
		});
	});

	describe("the last use of a key", () => {
		it("is noted on the first request on the platform clock, not again before a minute, and then again", async () => {
			await using test = createTestPlatform({ modules: [probe] });
			const key = test.prepare.key("kira");
			const other = test.prepare.key("kira");
			const lastUse = (of: string) =>
				test.keys().find(({ id }) => id === idOf(of))?.lastUsedAt;
			const client = appClient(test, bearer(key));
			expect(lastUse(key)).toBeNull();

			test.clock.advance(1000);
			const first = test.clock.now();
			await client.status();
			expect(lastUse(key)).toBe(first);

			test.clock.advance(59_999);
			await client.status();
			expect(lastUse(key)).toBe(first);

			test.clock.advance(1);
			await client.status();
			expect(lastUse(key)).toBe(test.clock.now());
			expect(lastUse(other)).toBeNull();
		});

		it("is not noted for a bad key", async () => {
			await using test = createTestPlatform({ modules: [probe] });
			const key = test.prepare.key("kira");
			const other = test.prepare.key("kira");

			await expect(
				appClient(test, {
					authorization: `Bearer domus_${idOf(key)}.${secretOf(other)}`,
				}).status(),
			).rejects.toMatchObject({ code: "UNAUTHORIZED" });
			expect(test.keys().map(({ lastUsedAt }) => lastUsedAt)).toEqual([null, null]);
		});
	});

	describe("every other route", () => {
		it("answers unauthorized to a good key, also next to a session that lives, and never repeats a credential", async () => {
			await using test = await probeWithAna();
			const key = test.prepare.key("kira");
			const mandate = randomBytes(32).toString("base64url");
			const browser = test.browser();
			await browser.signIn("ana@domus.test", PASSWORD);
			const session = test.contextOf(browser).session ?? "";
			const withKey = carrying(browser, { ...bearer(key), "domus-mandate": mandate });
			const client = clientFor(
				{ ...platformContract, probe: probeContract },
				{ baseUrl: TEST_ORIGIN, fetch: withKey.fetch },
			);

			await expect(client.probe.listNotes()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
			await expect(
				client.probe.addNote({ body: "leche" }, { context: { idempotencyKey: "k1" } }),
			).rejects.toMatchObject({ code: "UNAUTHORIZED" });
			await expect(client.sessions.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });

			const upload = new Request(new URL("/api/files", TEST_ORIGIN), {
				method: "POST",
				body: new Uint8Array([0xff, 0xd8, 0xff]),
				headers: { "content-length": "3", "x-file-name": "foto.jpg" },
			});
			for (const request of [
				upload,
				route("/api/files/download", "POST", {
					action: "probe.getNote",
					input: { id: 1 },
					file: "f",
				}),
				route("/api/events"),
				route("/api/notifications/key"),
				route("/api/notifications/subscription", "PUT", {
					endpoint: "https://fcm.googleapis.com/fcm/send/ana",
					keys: { p256dh: "p256dh-ana", auth: "auth-ana" },
				}),
				route("/api/notifications/subscription", "DELETE"),
			]) {
				const response = await withKey.fetch(request);
				expect({ path: new URL(request.url).pathname, status: response.status }).toEqual({
					path: new URL(request.url).pathname,
					status: 401,
				});
				expect(await response.json()).toMatchObject({ code: "UNAUTHORIZED" });
			}

			const signOut = await withKey.fetch(route("/api/auth/sign-out", "POST", {}));
			expect(signOut.status).toBe(401);
			expect(test.hasSession(session)).toBe(true);

			expect(test.log()).toEqual([]);
			for (const text of withKey.answers) {
				expect(text).not.toContain(key);
				expect(text).not.toContain(secretOf(key));
				expect(text).not.toContain(mandate);
			}
		});

		it("answers unauthorized to a mandate without its key, also next to a session that lives, on every route", async () => {
			await using test = await probeWithAna();
			const browser = test.browser();
			await browser.signIn("ana@domus.test", PASSWORD);
			const session = test.contextOf(browser).session ?? "";
			const mandate = test.mandate(browser);
			const client = clientFor(
				{ ...platformContract, probe: probeContract },
				{ baseUrl: TEST_ORIGIN, fetch: browser.fetch },
			);
			expect(await client.probe.listNotes()).toEqual([]);
			const withMandate = carrying(browser, { "domus-mandate": mandate });
			const mandated = clientFor(
				{ ...platformContract, probe: probeContract },
				{ baseUrl: TEST_ORIGIN, fetch: withMandate.fetch },
			);

			// A credential that cannot be resolved never falls back, to anonymous or to the session.
			await expect(
				appClient(test, { "domus-mandate": mandate }).status(),
			).rejects.toMatchObject({ code: "UNAUTHORIZED" });
			await expect(mandated.status()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
			await expect(mandated.probe.listNotes()).rejects.toMatchObject({
				code: "UNAUTHORIZED",
			});
			await expect(
				mandated.probe.addNote({ body: "leche" }, { context: { idempotencyKey: "k1" } }),
			).rejects.toMatchObject({ code: "UNAUTHORIZED" });
			await expect(mandated.log.read()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
			await expect(mandated.sessions.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });

			for (const request of [route("/api/notifications/key"), route("/api/events")]) {
				const response = await withMandate.fetch(request);
				expect({ path: new URL(request.url).pathname, status: response.status }).toEqual({
					path: new URL(request.url).pathname,
					status: 401,
				});
				expect(await response.json()).toMatchObject({ code: "UNAUTHORIZED" });
			}
			const signOut = await withMandate.fetch(route("/api/auth/sign-out", "POST", {}));
			expect(signOut.status).toBe(401);
			expect(await signOut.json()).toMatchObject({ code: "UNAUTHORIZED" });
			expect(test.hasSession(session)).toBe(true);

			expect(test.log()).toEqual([]);
			for (const text of withMandate.answers) expect(text).not.toContain(mandate);
		});

		it("signs nobody in with a key, in Better Auth's own form of errors", async () => {
			await using test = await probeWithAna();
			const key = test.prepare.key("kira");
			const browser = test.browser();
			const withKey = carrying(browser, bearer(key));

			const signIn = await withKey.fetch(
				route("/api/auth/sign-in/email", "POST", {
					email: "ana@domus.test",
					password: PASSWORD,
				}),
			);

			expect(signIn.status).toBe(401);
			const wrongPassword = await browser.signIn("ana@domus.test", "wrong password");
			const refused = (await signIn.json()) as object;
			expect(refused).toMatchObject({ code: "UNAUTHORIZED" });
			expect(Object.keys(refused).sort()).toEqual(
				Object.keys((await wrongPassword.json()) as object).sort(),
			);
			expect(browser.cookie(SESSION_COOKIE)).toBeUndefined();
			expect(withKey.answers.join("")).not.toContain(secretOf(key));
		});
	});
});

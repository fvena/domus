// probe over HTTP (ADR 0023): the door with probe composed in the test, Better Auth through its routes, and
// api-client on the same fetch, with the cookies kept explicitly by the test browser.
import { clientFor } from "@domus/api-client";
import { createTestPlatform, TEST_ORIGIN, type TestBrowser } from "@domus/test-utils";
import { describe, expect, it } from "vitest";

import { probeContract } from "../contracts";
import probe from "../server";
import { notes } from "../server/schema";

const PASSWORD = "correct horse battery staple";
const SESSION_COOKIE = "better-auth.session_token";
const DEVICE_COOKIE = "domus.device";

/** A platform with probe and Ana, a member with a password. */
async function probeWithAna() {
	const test = createTestPlatform({ modules: [probe] });
	test.prepare.account({ id: "ana", role: "member" });
	await test.prepare.password("ana", PASSWORD);
	return test;
}

/** probe's client on the browser's fetch, so its cookies travel. */
function probeClient(browser: TestBrowser) {
	return clientFor({ probe: probeContract }, { baseUrl: TEST_ORIGIN, fetch: browser.fetch });
}

describe("probe over HTTP", () => {
	describe("without a session", () => {
		it("answers unauthenticated to a read and a write, and runs neither", async () => {
			await using test = await probeWithAna();
			const client = probeClient(test.browser());

			await expect(client.probe.listNotes()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
			await expect(
				client.probe.addNote({ body: "pan" }, { context: { idempotencyKey: "k1" } }),
			).rejects.toMatchObject({ code: "UNAUTHORIZED" });
			expect(test.log()).toEqual([]);
		});

		it("answers unauthenticated after signing out", async () => {
			await using test = await probeWithAna();
			const browser = test.browser();
			await browser.signIn("ana@domus.test", PASSWORD);
			await browser.signOut();

			await expect(probeClient(browser).probe.listNotes()).rejects.toMatchObject({
				code: "UNAUTHORIZED",
			});
		});
	});

	describe("signing in", () => {
		it("creates a device, and signing out and in again keeps it", async () => {
			await using test = await probeWithAna();
			const browser = test.browser();

			expect((await browser.signIn("ana@domus.test", PASSWORD)).status).toBe(200);
			const device = browser.cookie(DEVICE_COOKIE);
			const firstSession = browser.cookie(SESSION_COOKIE);
			expect(device).toMatch(/^[\w-]{32}$/);

			await browser.signOut();
			expect(browser.cookie(SESSION_COOKIE)).toBeUndefined();
			expect(browser.cookie(DEVICE_COOKIE)).toBe(device);

			await browser.signIn("ana@domus.test", PASSWORD);
			expect(browser.cookie(DEVICE_COOKIE)).toBe(device);
			expect(browser.cookie(SESSION_COOKIE)).not.toBe(firstSession);
		});

		it("creates another device in another browser, or for a device cookie it does not know", async () => {
			await using test = await probeWithAna();
			const first = test.browser();
			const second = test.browser();
			await first.signIn("ana@domus.test", PASSWORD);
			await second.signIn("ana@domus.test", PASSWORD);
			expect(second.cookie(DEVICE_COOKIE)).not.toBe(first.cookie(DEVICE_COOKIE));

			const forged = test.browser();
			forged.setCookie(DEVICE_COOKIE, "a-device-nobody-created-000000000");
			await forged.signIn("ana@domus.test", PASSWORD);
			expect(forged.cookie(DEVICE_COOKIE)).not.toBe("a-device-nobody-created-000000000");
		});

		it("sets the device cookie HttpOnly, for the whole site and for long", async () => {
			await using test = await probeWithAna();
			const response = await test.browser().signIn("ana@domus.test", PASSWORD);

			const line = response.headers
				.getSetCookie()
				.find((cookie) => cookie.startsWith(`${DEVICE_COOKIE}=`));
			expect(line).toMatch(/; HttpOnly/i);
			expect(line).toMatch(/; Path=\//i);
			expect(line).toMatch(/; SameSite=Lax/i);
			expect(line).toMatch(/; Max-Age=34560000/i);
		});

		it("fails with a wrong password, and for the device account, which has none", async () => {
			await using test = await probeWithAna();
			const browser = test.browser();

			expect((await browser.signIn("ana@domus.test", "wrong password")).status).toBe(401);
			expect((await browser.signIn("device@domus.invalid", "")).ok).toBe(false);
			expect((await browser.signIn("device@domus.invalid", PASSWORD)).ok).toBe(false);
			expect(browser.cookie(SESSION_COOKIE)).toBeUndefined();
		});

		it("has open sign-up turned off: nobody creates an account from outside", async () => {
			await using test = await probeWithAna();
			const browser = test.browser();

			const signUp = await browser.fetch(
				new Request(`${TEST_ORIGIN}/api/auth/sign-up/email`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						email: "eve@domus.test",
						password: PASSWORD,
						name: "Eve",
					}),
				}),
			);

			expect(signUp.ok).toBe(false);
			expect((await browser.signIn("eve@domus.test", PASSWORD)).ok).toBe(false);
		});
	});

	describe("with a session", () => {
		it("runs an allowed read through api-client", async () => {
			await using test = await probeWithAna();
			test.dbFor(probe)
				.insert(notes)
				.values({ owner: "ana", visibility: "private", body: "comprar pan" })
				.run();
			const browser = test.browser();
			await browser.signIn("ana@domus.test", PASSWORD);

			expect(await probeClient(browser).probe.listNotes()).toEqual([
				{ id: 1, body: "comprar pan" },
			]);
		});

		it("denies a write the account's permission does not reach, and runs nothing", async () => {
			await using test = await probeWithAna();
			test.prepare.grant("ana", "probe", "read");
			const browser = test.browser();
			await browser.signIn("ana@domus.test", PASSWORD);
			const client = probeClient(browser);

			await expect(
				client.probe.addNote({ body: "pan" }, { context: { idempotencyKey: "k1" } }),
			).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
			expect(await client.probe.listNotes()).toEqual([]);
			expect(test.log()).toEqual([]);
		});

		it("runs a write as the session's account, ignoring who the client says it is", async () => {
			await using test = await probeWithAna();
			test.prepare.account({ id: "luis", role: "member" });
			const browser = test.browser();
			await browser.signIn("ana@domus.test", PASSWORD);

			const response = await browser.fetch(
				new Request(`${TEST_ORIGIN}/api/rpc/probe/addNote`, {
					method: "POST",
					headers: {
						"content-type": "application/json",
						"idempotency-key": "k1",
						"x-domus-account": "luis",
						"x-domus-via": "kira",
						"x-domus-channel": "contexto",
						"x-domus-identity": "voice",
						"x-domus-conversation": "c1",
					},
					body: JSON.stringify({
						json: {
							body: "pan",
							account: "luis",
							via: "kira",
							device: "another",
							channel: "contexto",
							identity: "voice",
							conversation: "c1",
						},
					}),
				}),
			);

			expect(response.status).toBe(200);
			expect(test.log()).toEqual([
				expect.objectContaining({
					actor: { account: "ana" },
					input: { body: "pan" },
				}),
			]);
		});
	});
});

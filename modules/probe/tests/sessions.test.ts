// Passwords and sessions over HTTP (ADR 0023): the door with probe composed in the test, Better Auth through its
// routes and api-client for the platform's operations, with the cookies kept explicitly by the test browser.
import { clientFor } from "@domus/api-client";
import {
	createTestPlatform,
	platformContract,
	TEST_ORIGIN,
	type TestBrowser,
} from "@domus/test-utils";
import { describe, expect, it } from "vitest";

import { probeContract } from "../contracts";
import probe from "../server";

const PASSWORD = "correct horse battery staple";
const NEW_PASSWORD = "a brand new passphrase";
const SESSION_COOKIE = "better-auth.session_token";
const DEVICE_COOKIE = "domus.device";

/** A platform with probe, and Ana and Luis, members with a password. */
async function probeWithAnaAndLuis() {
	const test = createTestPlatform({ modules: [probe] });
	for (const id of ["ana", "luis"]) {
		test.prepare.account({ id, role: "member" });
		await test.prepare.password(id, PASSWORD);
	}
	return test;
}

/** The platform's and probe's clients on the browser's fetch, so its cookies travel. */
function clientOf(browser: TestBrowser) {
	return clientFor(
		{ ...platformContract, probe: probeContract },
		{ baseUrl: TEST_ORIGIN, fetch: browser.fetch },
	);
}

/** A browser signed in as `who`. */
async function signedIn(test: { browser(): TestBrowser }, who: string): Promise<TestBrowser> {
	const browser = test.browser();
	expect((await browser.signIn(`${who}@domus.test`, PASSWORD)).status).toBe(200);
	return browser;
}

describe("sessions and passwords over HTTP", () => {
	it("answers unauthenticated to the platform's operations without a session", async () => {
		await using test = await probeWithAnaAndLuis();
		const client = clientOf(test.browser());

		await expect(client.sessions.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
		await expect(
			client.password.change({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD }),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });
		expect((await test.browser().signIn("ana@domus.test", PASSWORD)).status).toBe(200);
	});

	describe("my sessions", () => {
		it("lists only my own, marking the current one, with its device and never a token", async () => {
			await using test = await probeWithAnaAndLuis();
			const phone = await signedIn(test, "ana");
			const laptop = await signedIn(test, "ana");
			await signedIn(test, "luis");

			const sessions = await clientOf(phone).sessions.list();

			expect(sessions).toHaveLength(2);
			expect(sessions.filter((session) => session.current)).toHaveLength(1);
			expect(sessions[0]).toEqual({
				id: expect.any(String),
				current: expect.any(Boolean),
				createdAt: expect.any(Number),
				expiresAt: expect.any(Number),
				device: { name: null, createdAt: expect.any(Number) },
			});
			const tokens = [phone, laptop].map(
				(browser) => browser.cookie(SESSION_COOKIE)?.split(".")[0],
			);
			for (const token of tokens) expect(JSON.stringify(sessions)).not.toContain(token);
			const fromLaptop = await clientOf(laptop).sessions.list();
			expect(fromLaptop.map(({ id }) => id)).toEqual(sessions.map(({ id }) => id));
			expect(fromLaptop.find((session) => session.current)?.id).not.toBe(
				sessions.find((session) => session.current)?.id,
			);
		});

		it("closes the current session by signing out: it fails on the next request, and the others stay", async () => {
			await using test = await probeWithAnaAndLuis();
			const phone = await signedIn(test, "ana");
			const laptop = await signedIn(test, "ana");
			const stolen = phone.cookie(SESSION_COOKIE);

			await phone.signOut();

			// The same cookie, sent again by someone who kept it, names no session.
			const replay = test.browser();
			replay.setCookie(SESSION_COOKIE, stolen);
			await expect(clientOf(replay).probe.listNotes()).rejects.toMatchObject({
				code: "UNAUTHORIZED",
			});
			await expect(clientOf(replay).sessions.list()).rejects.toMatchObject({
				code: "UNAUTHORIZED",
			});
			expect(await clientOf(laptop).sessions.list()).toHaveLength(1);
		});
	});

	describe("changing my password from the app", () => {
		it("asks for the current one, keeps only this session and ends the others on their next request", async () => {
			await using test = await probeWithAnaAndLuis();
			const phone = await signedIn(test, "ana");
			const laptop = await signedIn(test, "ana");
			const luis = await signedIn(test, "luis");
			const [current] = (await clientOf(phone).sessions.list()).filter((s) => s.current);

			const changed = await clientOf(phone).password.change({
				currentPassword: PASSWORD,
				newPassword: NEW_PASSWORD,
			});

			expect(changed).toEqual({ endedSessions: 1 });
			expect(await clientOf(phone).sessions.list()).toEqual([current]);
			expect(await clientOf(phone).probe.listNotes()).toEqual([]);
			await expect(clientOf(laptop).probe.listNotes()).rejects.toMatchObject({
				code: "UNAUTHORIZED",
			});
			expect(await clientOf(luis).sessions.list()).toHaveLength(1);
			expect((await test.browser().signIn("ana@domus.test", PASSWORD)).status).toBe(401);
			expect((await test.browser().signIn("ana@domus.test", NEW_PASSWORD)).status).toBe(200);
		});

		it("changes nothing with a wrong current password, and repeats neither password", async () => {
			await using test = await probeWithAnaAndLuis();
			const phone = await signedIn(test, "ana");
			const laptop = await signedIn(test, "ana");

			const response = await phone.fetch(
				new Request(`${TEST_ORIGIN}/api/rpc/password/change`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						json: { currentPassword: "not my password", newPassword: NEW_PASSWORD },
					}),
				}),
			);

			expect(response.status).toBe(403);
			const body = await response.text();
			expect(body).toContain("wrong-password");
			expect(body).not.toContain("not my password");
			expect(body).not.toContain(NEW_PASSWORD);
			expect(await clientOf(laptop).sessions.list()).toHaveLength(2);
			expect((await test.browser().signIn("ana@domus.test", PASSWORD)).status).toBe(200);
		});

		it.each([
			["too short", "short"],
			["too long", "x".repeat(129)],
		])("refuses a new password %s without repeating it", async (_case, newPassword) => {
			await using test = await probeWithAnaAndLuis();
			const phone = await signedIn(test, "ana");

			const response = await phone.fetch(
				new Request(`${TEST_ORIGIN}/api/rpc/password/change`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ json: { currentPassword: PASSWORD, newPassword } }),
				}),
			);

			expect(response.status).toBe(400);
			const body = await response.text();
			expect(body).not.toContain(newPassword);
			expect(body).not.toContain(PASSWORD);
			expect((await test.browser().signIn("ana@domus.test", PASSWORD)).status).toBe(200);
		});
	});

	describe("two people in the same browser", () => {
		it("keeps the device when the account changes, and no session of the first passes to the second", async () => {
			await using test = await probeWithAnaAndLuis();
			const browser = await signedIn(test, "ana");
			const device = browser.cookie(DEVICE_COOKIE);
			const anaSessions = await clientOf(browser).sessions.list();
			const anaElsewhere = await signedIn(test, "ana");

			// Luis signs in on the same browser, without Ana signing out first.
			expect((await browser.signIn("luis@domus.test", PASSWORD)).status).toBe(200);

			expect(browser.cookie(DEVICE_COOKIE)).toBe(device);
			const luisSessions = await clientOf(browser).sessions.list();
			expect(luisSessions).toEqual([
				expect.objectContaining({
					current: true,
					device: anaSessions[0]?.device,
				}),
			]);
			expect(luisSessions[0]?.id).not.toBe(anaSessions[0]?.id);
			// Ana's session on this browser is still hers, seen only from her side.
			expect((await clientOf(anaElsewhere).sessions.list()).map(({ id }) => id)).toContain(
				anaSessions[0]?.id,
			);

			// Ana signs in again on the same browser: same device, and none of Luis's sessions.
			await browser.signOut();
			expect((await browser.signIn("ana@domus.test", PASSWORD)).status).toBe(200);
			expect(browser.cookie(DEVICE_COOKIE)).toBe(device);
			const again = (await clientOf(browser).sessions.list()).map(({ id }) => id);
			expect(again).not.toContain(luisSessions[0]?.id);
			expect(again).toHaveLength(3);
		});
	});
});

// When a mandate dies (spec of phase 1e, «Mandatos», ADR 0030): it resolves only while its session lives by the one
// rule of the platform, so each of the ways of ending a session inside `api`, and its expiry on the platform clock,
// ends a mandate that already worked, on the next request; a mandate of another session of the same person goes
// on. Changing the password with `pnpm accounts` is proved by the tests of its core, in platform. Reopening the
// platform on the same file keeps a live mandate and a key.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { clientFor } from "@domus/api-client";
import {
	createTestPlatform,
	platformContract,
	TEST_ORIGIN,
	type TestBrowser,
	type TestPlatform,
} from "@domus/test-utils";
import { describe, expect, it } from "vitest";

import { probeContract } from "../contracts";
import probe from "../server";

type Probe = TestPlatform<readonly [typeof probe]>;

const PASSWORD = "correct horse battery staple";
const NEW_PASSWORD = "another horse battery staple";
const MINUTE = 60 * 1000;
const DEVICE_COOKIE = "domus.device";

const contract = { ...platformContract, probe: probeContract };

/** A platform with probe where Ana, a member, Eva, the admin, and the device account each have a password. */
async function household(options: { readonly file?: string } = {}): Promise<Probe> {
	const test = createTestPlatform({ modules: [probe], ...options });
	for (const [id, role] of [
		["ana", "member"],
		["eva", "admin"],
	] as const) {
		test.prepare.account({ id, role });
		await test.prepare.password(id, PASSWORD);
	}
	await test.prepare.password(test.deviceAccount, PASSWORD);
	return test;
}

/** Signs `who` in on `browser`, a new one unless given, which then holds the new session. */
async function signedIn(test: Probe, who: string, browser = test.browser()): Promise<TestBrowser> {
	const email = who === test.deviceAccount ? "device@domus.invalid" : `${who}@domus.test`;
	expect((await browser.signIn(email, PASSWORD)).status).toBe(200);
	return browser;
}

/** The device account's browser on the screen where each of Ana's browsers in it signed in. */
const screens = new WeakMap<TestBrowser, TestBrowser>();

/** Ana signed in on the kitchen's screen, a device of the device account, which an admin may revoke. */
async function anaOnTheScreen(test: Probe): Promise<TestBrowser> {
	const screen = await signedIn(test, test.deviceAccount);
	const there = test.browser();
	there.setCookie(DEVICE_COOKIE, screen.cookie(DEVICE_COOKIE));
	screens.set(there, screen);
	return signedIn(test, "ana", there);
}

/** Kira's client with its key and a mandate, as `assistant` calls: never a browser's cookie. */
function kiraWith(test: Probe, key: string, mandate: string) {
	return clientFor(contract, {
		baseUrl: TEST_ORIGIN,
		fetch: test.door.fetch,
		headers: { authorization: `Bearer ${key}`, "domus-mandate": mandate },
	});
}

/** The client of the app, in a signed-in browser with its cookies. */
function app(browser: TestBrowser) {
	return clientFor(contract, { baseUrl: TEST_ORIGIN, fetch: browser.fetch });
}

let keys = 0;
/** A fresh idempotency key. */
function keyed() {
	keys += 1;
	return { idempotencyKey: `k${String(keys)}` };
}

/** What Kira's read with `mandate` answers: `"ok"` or the code of the error. */
async function readsWith(test: Probe, key: string, mandate: string): Promise<string> {
	try {
		await kiraWith(test, key, mandate).probe.listNotes();
		return "ok";
	} catch (error) {
		return String((error as { code?: unknown }).code);
	}
}

/**
 * Ana's laptop, `laptop` when given, and her phone, each signed in with a mandate that already worked, a write
 * and a read, and Kira's key.
 */
async function anaWithTwoMandates(test: Probe, laptop?: TestBrowser) {
	const key = test.prepare.key("kira");
	const onLaptop = test.mandate(laptop ?? (laptop = await signedIn(test, "ana")));
	const phone = await signedIn(test, "ana");
	const onPhone = test.mandate(phone);
	expect(
		await kiraWith(test, key, onLaptop).probe.addNote({ body: "leche" }, { context: keyed() }),
	).toMatchObject({ entry: 1 });
	expect(await readsWith(test, key, onPhone)).toBe("ok");
	return { key, laptop, phone, onLaptop, onPhone };
}

type Ana = Awaited<ReturnType<typeof anaWithTwoMandates>>;

/** One way of ending the session of Ana's laptop: where she is signed in, and what ends it. */
interface Ending {
	readonly laptop?: (test: Probe) => Promise<TestBrowser>;
	readonly end: (test: Probe, ana: Ana) => Promise<void>;
}

const ENDINGS: Record<string, Ending> = {
	"signing out": {
		end: async (_test, { laptop }) => {
			expect((await laptop.signOut()).status).toBe(200);
		},
	},
	"revoking the session from another": {
		end: async (test, { laptop, phone }) => {
			const fromPhone = test.contextOf(phone);
			const session = test.contextOf(laptop).session ?? "";
			const { proof } = await test.requestProof(fromPhone, PASSWORD, {
				action: "platform.revokeSession",
				input: { session },
			});
			test.revokeSession(fromPhone, session, { ...keyed(), proof });
		},
	},
	// Only a device of the device account is revoked, so the laptop is then Ana's session on the kitchen's screen.
	"revoking the device": {
		laptop: anaOnTheScreen,
		end: async (test, { laptop }) => {
			const eva = test.context("eva");
			const screen = screens.get(laptop);
			if (!screen) throw new Error("Ana is not on the screen");
			const session = test.contextOf(screen).session ?? "";
			const { proof } = await test.requestProof(eva, PASSWORD, {
				action: "platform.revokeDevice",
				input: { session },
			});
			expect(test.revokeDevice(eva, session, { ...keyed(), proof })).toMatchObject({
				result: { endedSessions: 2 },
			});
		},
	},
	"changing the password from the app": {
		end: async (_test, { phone }) => {
			expect(
				await app(phone).password.change({
					currentPassword: PASSWORD,
					newPassword: NEW_PASSWORD,
				}),
			).toEqual({ endedSessions: 1 });
		},
	},
};

describe("a mandate that already worked, once its session ends", () => {
	for (const [way, { laptop, end }] of Object.entries(ENDINGS))
		it(`is no longer good after ${way}, and a mandate of another session of the person goes on`, async () => {
			await using test = await household();
			const ana = await anaWithTwoMandates(test, await laptop?.(test));

			await end(test, ana);

			expect(await readsWith(test, ana.key, ana.onLaptop)).toBe("UNAUTHORIZED");
			expect(await readsWith(test, ana.key, ana.onPhone)).toBe("ok");
		});

	it("is no longer good once its session expires on the platform clock, though the mandate had minutes left", async () => {
		await using test = await household();
		const key = test.prepare.key("kira");
		const laptop = await signedIn(test, "ana");
		const expiry = test.sessionExpiresAt(test.contextOf(laptop).session ?? "") ?? 0;
		test.clock.set(expiry - 5 * MINUTE, { wake: false });
		const mandate = test.mandate(laptop);
		expect(await readsWith(test, key, mandate)).toBe("ok");

		test.clock.set(expiry - 1, { wake: false });
		expect(await readsWith(test, key, mandate)).toBe("ok");
		test.clock.set(expiry, { wake: false });
		expect(await readsWith(test, key, mandate)).toBe("UNAUTHORIZED");
	});
});

describe("reopening the platform on the same file", () => {
	it("keeps a live mandate and a key good", async () => {
		const folder = mkdtempSync(join(tmpdir(), "domus-mandate-end-"));
		try {
			const file = join(folder, "domus.db");
			let key: string;
			let mandate: string;
			{
				await using before = await household({ file });
				key = before.prepare.key("kira");
				mandate = before.mandate(await signedIn(before, "ana"));
				expect(await readsWith(before, key, mandate)).toBe("ok");
			}

			await using test = createTestPlatform({ modules: [probe], file });

			expect(await readsWith(test, key, mandate)).toBe("ok");
		} finally {
			rmSync(folder, { recursive: true, force: true });
		}
	});
});

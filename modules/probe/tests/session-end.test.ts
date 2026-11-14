// When a session ends (spec of phase 1d4, «Cuando termina una sesión», ADR 0029): every way of ending it inside
// `api` writes `purge` on the channels of the sessions it ended, and on no other, once what ends them committed,
// and closes them. What ends a session outside `api` the heartbeat finds; a session's expiry too, which the tests
// of the channel cover. No way of ending a session gives its device's notices back to an earlier one. Each test
// reads the stream of the door as a browser would; a heartbeat, 25 s of the test clock, closes what each step
// expects.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { clientFor } from "@domus/api-client";
import { sql } from "@domus/module-sdk/db";
import {
	createTestPlatform,
	type EventReader,
	openChannel,
	platformContract,
	TEST_ORIGIN,
	type TestBrowser,
	type TestPlatform,
	type VerifiedContext,
} from "@domus/test-utils";
import { afterEach, describe, expect, it } from "vitest";

import { probeContract } from "../contracts";
import probe from "../server";

type Probe = TestPlatform<readonly [typeof probe]>;

const PASSWORD = "correct horse battery staple";
const NEW_PASSWORD = "another horse battery staple";
const HEARTBEAT = 25_000;
const READY = { event: "ready", data: {} };
const PURGE = { event: "purge", data: {} };
const DEVICE_COOKIE = "domus.device";

/** An invalidation of probe's board notes. */
function boardNotes(...ids: number[]) {
	return {
		event: "invalidate",
		data: { records: ids.map((id) => ({ module: "probe", type: "board", id })) },
	};
}

/**
 * A platform with probe where Ana and Luis, members, Eva, the admin, and the device account each have a
 * password.
 */
async function household(options: { readonly file?: string } = {}) {
	const test = createTestPlatform({ modules: [probe], ...options });
	for (const [id, role] of [
		["ana", "member"],
		["luis", "member"],
		["eva", "admin"],
	] as const) {
		test.prepare.account({ id, role });
		await test.prepare.password(id, PASSWORD);
	}
	await test.prepare.password(test.deviceAccount, PASSWORD);
	return test;
}

/** The email `who` signs in with: the device account's, or a person's. */
function emailOf(test: Probe, who: string): string {
	return who === test.deviceAccount ? "device@domus.invalid" : `${who}@domus.test`;
}

/** Signs `who` in on `browser`, a new one unless given, which then holds the new session. */
async function signedIn(test: Probe, who: string, browser = test.browser()): Promise<TestBrowser> {
	expect((await browser.signIn(emailOf(test, who), PASSWORD)).status).toBe(200);
	return browser;
}

/** Another browser on the same device as `browser`, holding the same session for now. */
function copyOf(test: Probe, browser: TestBrowser): TestBrowser {
	const copy = test.browser();
	for (const [name, value] of Object.entries(browser.cookies())) copy.setCookie(name, value);
	return copy;
}

/** A browser signed in as `who`, a new one unless given, with its channel open and its `ready` read. */
async function listening(test: Probe, who: string, browser?: TestBrowser) {
	const signed = browser ?? (await signedIn(test, who));
	const channel = await openChannel(signed);
	expect(await channel.next()).toEqual(READY);
	return { browser: signed, channel, context: test.contextOf(signed) };
}

/** Everything `channel` reads until its stream ends. */
async function untilEnd(channel: EventReader): Promise<unknown[]> {
	const read: unknown[] = [];
	for (let item = await channel.next(); item !== "end"; item = await channel.next())
		read.push(item);
	return read;
}

/** What `channel` reads next, until its heartbeat: the events before it, in order. */
async function untilBeat(channel: EventReader): Promise<unknown[]> {
	const read: unknown[] = [];
	for (;;) {
		const item = await channel.next();
		if (item === "end") throw new Error(`the channel ended after ${JSON.stringify(read)}`);
		if ("comment" in item) return read;
		read.push(item);
	}
}

function clientOf(browser: TestBrowser) {
	return clientFor(
		{ ...platformContract, probe: probeContract },
		{ baseUrl: TEST_ORIGIN, fetch: browser.fetch },
	);
}

let keys = 0;
/** A fresh idempotency key. */
function key() {
	keys += 1;
	return { idempotencyKey: `k${keys}` };
}

/** Subscribes the browser's device to notices through the door: the status it answers. */
async function subscribe(browser: TestBrowser, name: string): Promise<number> {
	const response = await browser.fetch(
		new Request(new URL("/api/notifications/subscription", TEST_ORIGIN), {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				endpoint: `https://fcm.googleapis.com/fcm/send/${name}`,
				keys: { p256dh: `p256dh-${name}`, auth: `auth-${name}` },
			}),
		}),
	);
	await response.body?.cancel();
	return response.status;
}

/** Revokes `session` as `context`, with the proof it asks for. */
async function revokeSession(test: Probe, context: VerifiedContext, session: string) {
	const { proof } = await test.requestProof(context, PASSWORD, {
		action: "platform.revokeSession",
		input: { session },
	});
	return test.revokeSession(context, session, { ...key(), proof });
}

/**
 * Ana's phone and laptop, each listening, and Luis's phone listening. Luis signed in on the laptop before Ana
 * entered it, and that earlier session still lives on `earlier`, a copy of the laptop. Ana subscribed the laptop.
 */
async function laptopOfAna(test: Probe) {
	const laptop = await signedIn(test, "luis");
	const earlier = copyOf(test, laptop);
	await signedIn(test, "ana", laptop);
	expect(await subscribe(laptop, "laptop")).toBe(200);
	return {
		laptop: await listening(test, "ana", laptop),
		otherTab: await listening(test, "ana", laptop),
		earlier,
		phone: await listening(test, "ana"),
		luis: await listening(test, "luis"),
	};
}

type Laptop = Awaited<ReturnType<typeof laptopOfAna>>;

/**
 * The laptop's session ended: both its tabs read `purge` and end; Ana's phone and Luis go on; the laptop's
 * subscription went with its session, and Luis's earlier session there does not get it back.
 */
async function laptopEnded(test: Probe, { laptop, otherTab, earlier, phone, luis }: Laptop) {
	expect(await untilEnd(laptop.channel)).toEqual([PURGE]);
	expect(await untilEnd(otherTab.channel)).toEqual([PURGE]);
	test.invoke(luis.context, "probe.addBoardNote", { body: "cena" }, key());
	test.clock.advance(HEARTBEAT);
	expect(await untilBeat(phone.channel)).toEqual([boardNotes(1)]);
	expect(await untilBeat(luis.channel)).toEqual([boardNotes(1)]);
	expect(test.subscriptions()).toEqual([]);
	expect(await subscribe(earlier, "laptop")).toBe(409);
	expect(test.subscriptions()).toEqual([]);
}

describe("ending a session inside api", () => {
	it("signing out writes purge on that session's channels, every tab of it, and on no other", async () => {
		await using test = await household();
		const ana = await laptopOfAna(test);

		expect((await ana.laptop.browser.signOut()).status).toBe(200);

		await laptopEnded(test, ana);
	});

	it("revoking a session from another writes purge on the revoked one's channels, and on no other", async () => {
		await using test = await household();
		const ana = await laptopOfAna(test);

		await revokeSession(test, ana.phone.context, ana.laptop.context.session ?? "");

		await laptopEnded(test, ana);
	});

	it("changing the password writes purge on the channels of every other session of the account", async () => {
		await using test = await household();
		const ana = await laptopOfAna(test);

		expect(
			await clientOf(ana.phone.browser).password.change({
				currentPassword: PASSWORD,
				newPassword: NEW_PASSWORD,
			}),
		).toEqual({ endedSessions: 1 });

		await laptopEnded(test, ana);
	});

	it("revoking a device writes purge on the channels of every session of it, whoever's, and on no other", async () => {
		await using test = await household();
		const screen = await listening(test, test.deviceAccount);
		// Ana signs in on the kitchen's screen too, and subscribes it.
		const anaThere = test.browser();
		anaThere.setCookie(DEVICE_COOKIE, screen.browser.cookie(DEVICE_COOKIE));
		const onScreen = await listening(test, "ana", await signedIn(test, "ana", anaThere));
		expect(await subscribe(anaThere, "screen")).toBe(200);
		const phone = await listening(test, "ana");
		const luis = await listening(test, "luis");
		const eva = test.context("eva");
		const session = screen.context.session ?? "";
		const { proof } = await test.requestProof(eva, PASSWORD, {
			action: "platform.revokeDevice",
			input: { session },
		});

		expect(test.revokeDevice(eva, session, { ...key(), proof })).toMatchObject({
			result: { endedSessions: 2 },
		});

		expect(await untilEnd(screen.channel)).toEqual([PURGE]);
		expect(await untilEnd(onScreen.channel)).toEqual([PURGE]);
		test.invoke(luis.context, "probe.addBoardNote", { body: "cena" }, key());
		test.clock.advance(HEARTBEAT);
		expect(await untilBeat(phone.channel)).toEqual([boardNotes(1)]);
		expect(await untilBeat(luis.channel)).toEqual([boardNotes(1)]);
		expect(test.subscriptions()).toEqual([]);
	});

	it("does not write purge when what ends the session rolls back", async () => {
		await using test = await household();
		const ana = await laptopOfAna(test);
		// The operation's entry in the action log fails, after the session's row went.
		test.dbFor(probe).run(
			sql.raw(`CREATE TEMP TRIGGER domus_test_fails AFTER INSERT ON platform_action_log
				BEGIN SELECT RAISE(ABORT, 'the log fails'); END`),
		);

		await expect(
			revokeSession(test, ana.phone.context, ana.laptop.context.session ?? ""),
		).rejects.toThrow();
		test.dbFor(probe).run(sql.raw("DROP TRIGGER temp.domus_test_fails"));
		test.clock.advance(HEARTBEAT);

		expect(await untilBeat(ana.laptop.channel)).toEqual([]);
		expect(await untilBeat(ana.otherTab.channel)).toEqual([]);
		expect(test.hasSession(ana.laptop.context.session ?? "")).toBe(true);
		expect(test.subscriptions()).toEqual([expect.objectContaining({ enabled: true })]);
	});
});

const folders: string[] = [];
afterEach(() => {
	for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

describe("ending a session outside api", () => {
	it("is found by the next heartbeat: a session ended from a second connection to the same file gets purge", async () => {
		// This proves that the heartbeat finds a change made outside the process, here a revocation through another
		// platform on the same file, not that `pnpm accounts` revokes well: its own tests of phase 1c cover that.
		const folder = mkdtempSync(join(tmpdir(), "domus-session-end-"));
		folders.push(folder);
		const file = join(folder, "domus.db");
		await using test = await household({ file });
		const ana = await laptopOfAna(test);
		await using other = createTestPlatform({ modules: [probe], file });
		const fromPhone = other.context("ana", {
			session: ana.phone.context.session ?? "",
			device: ana.phone.context.device,
		});
		const { proof } = await other.requestProof(fromPhone, PASSWORD, {
			action: "platform.revokeSession",
			input: { session: ana.laptop.context.session ?? "" },
		});
		other.revokeSession(fromPhone, ana.laptop.context.session ?? "", { ...key(), proof });

		test.clock.advance(HEARTBEAT);

		expect(await untilEnd(ana.laptop.channel)).toEqual([PURGE]);
		expect(await untilEnd(ana.otherTab.channel)).toEqual([PURGE]);
		expect(await untilBeat(ana.phone.channel)).toEqual([]);
		expect(await untilBeat(ana.luis.channel)).toEqual([]);
		expect(test.subscriptions()).toEqual([]);
		expect(await subscribe(ana.earlier, "laptop")).toBe(409);
	});
});

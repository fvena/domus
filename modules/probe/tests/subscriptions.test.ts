// Subscriptions to notices (ADR 0029, spec of phase 1d4, «Suscripciones»): the app asks for the public key of
// VAPID, subscribes its device from the session the device has enabled and may unsubscribe, through routes of the
// door with a session. Another account signing in on that browser leaves the earlier subscription without effect.
import { createPublicKey } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	createTestPlatform,
	type InterleavePoint,
	TEST_ORIGIN,
	type TestBrowser,
	type TestPlatform,
} from "@domus/test-utils";
import { afterEach, describe, expect, it } from "vitest";

import probe from "../server";

const PASSWORD = "correct horse battery staple";

const KEY_PATH = "/api/notifications/key";
const SUBSCRIPTION_PATH = "/api/notifications/subscription";
const DEVICE_COOKIE = "domus.device";
const SESSION_COOKIE = "better-auth.session_token";

/** A platform with probe where Paco and Rocío, members, have a password. */
async function household(
	options: {
		readonly file?: string;
		readonly interleave?: (point: InterleavePoint) => Promise<void> | void;
	} = {},
) {
	const test = createTestPlatform({ modules: [probe], ...options });
	for (const id of ["paco", "rocio"]) {
		test.prepare.account({ id, role: "member" });
		await test.prepare.password(id, PASSWORD);
	}
	return test;
}

async function signedIn(test: { browser(): TestBrowser }, who: string): Promise<TestBrowser> {
	const browser = test.browser();
	expect((await browser.signIn(`${who}@domus.test`, PASSWORD)).status).toBe(200);
	return browser;
}

/** Signs `who` in on `browser`, the same device, which then holds the new session. */
async function enter(browser: TestBrowser, who: string): Promise<void> {
	expect((await browser.signIn(`${who}@domus.test`, PASSWORD)).status).toBe(200);
}

/** Another browser on the same device as `browser`, holding the same session for now. */
function copyOf(test: { browser(): TestBrowser }, browser: TestBrowser): TestBrowser {
	const copy = test.browser();
	for (const [name, value] of Object.entries(browser.cookies())) copy.setCookie(name, value);
	return copy;
}

/** What the app sends for a browser's push subscription, its endpoint and keys, on a service Domus admits. */
function pushSubscription(name: string, keys = { p256dh: `p256dh-${name}`, auth: `auth-${name}` }) {
	return { endpoint: `https://fcm.googleapis.com/fcm/send/${name}`, keys };
}

function key(browser: TestBrowser): Promise<Response> {
	return browser.fetch(new Request(new URL(KEY_PATH, TEST_ORIGIN)));
}

function subscribe(browser: TestBrowser, body: unknown): Promise<Response> {
	return browser.fetch(
		new Request(new URL(SUBSCRIPTION_PATH, TEST_ORIGIN), {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: typeof body === "string" ? body : JSON.stringify(body),
		}),
	);
}

function unsubscribe(browser: TestBrowser): Promise<Response> {
	return browser.fetch(
		new Request(new URL(SUBSCRIPTION_PATH, TEST_ORIGIN), { method: "DELETE" }),
	);
}

/** The status and the body of an answer. */
async function answer(response: Response) {
	return {
		status: response.status,
		body: response.status === 204 ? null : ((await response.json()) as unknown),
	};
}

type Person = "paco" | "rocio";

/** A promise and what settles it. */
function resolvable(): { readonly promise: Promise<void>; readonly resolve: () => void } {
	let resolve = () => undefined as void;
	const promise = new Promise<void>((settle) => {
		resolve = settle;
	});
	return { promise, resolve: () => resolve() };
}

const notEnabled = {
	status: 409,
	body: expect.objectContaining({ code: "CONFLICT", data: { reason: "session-not-enabled" } }),
};

/** Who each subscription is of and whether it is enabled, oldest first. */
function subscribers(test: TestPlatform) {
	return test.subscriptions().map(({ account, endpoint, enabled }) => ({
		account,
		endpoint,
		enabled,
	}));
}

const folders: string[] = [];
afterEach(() => {
	for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

describe("the public key of VAPID", () => {
	it("is a P-256 point in base64url, the same after closing and opening the platform on the same file", async () => {
		const folder = mkdtempSync(join(tmpdir(), "domus-keys-"));
		folders.push(folder);
		const file = join(folder, "domus.db");

		let first: string;
		{
			await using test = await household({ file });
			const response = await key(await signedIn(test, "paco"));
			expect(response.status).toBe(200);
			({ key: first } = (await response.json()) as { key: string });
		}
		await using reopened = createTestPlatform({ modules: [probe], file });
		const again = (await (await key(await signedIn(reopened, "rocio"))).json()) as {
			key: string;
		};

		expect(again.key).toBe(first);
		const point = Buffer.from(first, "base64url");
		expect([point.length, point[0]]).toEqual([65, 0x04]);
		// Only a point on the curve imports as a P-256 public key.
		const imported = createPublicKey({
			key: {
				kty: "EC",
				crv: "P-256",
				x: point.subarray(1, 33).toString("base64url"),
				y: point.subarray(33).toString("base64url"),
			},
			format: "jwk",
		});
		expect(imported.asymmetricKeyDetails?.namedCurve).toBe("prime256v1");
	});
});

describe("subscribing", () => {
	it("leaves one subscription of the person's device and session, and the same again changes nothing", async () => {
		await using test = await household();
		const phone = await signedIn(test, "paco");

		expect(await answer(await subscribe(phone, pushSubscription("phone")))).toEqual({
			status: 200,
			body: { subscribed: true },
		});
		const [first] = test.subscriptions();
		const { device, session } = test.contextOf(phone);
		expect(first).toEqual({
			id: expect.any(String),
			device,
			session,
			account: "paco",
			endpoint: pushSubscription("phone").endpoint,
			p256dh: "p256dh-phone",
			auth: "auth-phone",
			createdAt: expect.any(Number),
			enabled: true,
		});

		test.clock.advance(1000);
		expect((await subscribe(phone, pushSubscription("phone"))).status).toBe(200);
		expect(test.subscriptions()).toEqual([first]);
	});

	it("replaces the device's subscription with another id when its endpoint or keys change", async () => {
		await using test = await household();
		const phone = await signedIn(test, "paco");
		await subscribe(phone, pushSubscription("old"));
		const [old] = test.subscriptions();

		await subscribe(phone, pushSubscription("new"));
		const [renewed] = test.subscriptions();
		await subscribe(phone, pushSubscription("new", { p256dh: "other", auth: "other" }));
		const [rekeyed] = test.subscriptions();

		expect(test.subscriptions()).toHaveLength(1);
		expect(new Set([old?.id, renewed?.id, rekeyed?.id]).size).toBe(3);
		expect(rekeyed).toMatchObject({
			endpoint: pushSubscription("new").endpoint,
			p256dh: "other",
		});
	});

	it("moves an endpoint to another session as a new subscription, deleting the earlier one", async () => {
		await using test = await household();
		const laptop = await signedIn(test, "paco");
		await subscribe(laptop, pushSubscription("shared"));
		const [paco] = test.subscriptions();

		// Rocío on the same browser, whose one endpoint is the same.
		await enter(laptop, "rocio");
		await subscribe(laptop, pushSubscription("shared"));
		// The same endpoint from another device belongs to that device's subscription alone.
		const phone = await signedIn(test, "paco");
		const [rocio] = test.subscriptions();
		await subscribe(phone, pushSubscription("shared"));

		expect(rocio).toMatchObject({ account: "rocio", enabled: true });
		expect(rocio?.id).not.toBe(paco?.id);
		expect(test.subscriptions()).toEqual([
			expect.objectContaining({ account: "paco", device: test.contextOf(phone).device }),
		]);
		expect(test.subscriptions()[0]?.id).not.toBe(paco?.id);
	});

	it("answers UNAUTHORIZED without a session or with one expired on the platform clock, its row still there", async () => {
		await using test = await household();
		const phone = await signedIn(test, "paco");
		const unauthorized = {
			status: 401,
			body: expect.objectContaining({ code: "UNAUTHORIZED", status: 401 }),
		};

		const anonymous = test.browser();
		expect(await answer(await key(anonymous))).toEqual(unauthorized);
		expect(await answer(await subscribe(anonymous, pushSubscription("x")))).toEqual(
			unauthorized,
		);
		expect(await answer(await unsubscribe(anonymous))).toEqual(unauthorized);

		await subscribe(phone, pushSubscription("phone"));
		const { session = "" } = test.contextOf(phone);
		test.clock.set(test.sessionExpiresAt(session) ?? 0, { wake: false });
		expect(test.hasSession(session)).toBe(true);
		expect(await answer(await key(phone))).toEqual(unauthorized);
		expect(await answer(await subscribe(phone, pushSubscription("other")))).toEqual(
			unauthorized,
		);
		expect(await answer(await unsubscribe(phone))).toEqual(unauthorized);
		expect(subscribers(test)).toEqual([
			{ account: "paco", endpoint: pushSubscription("phone").endpoint, enabled: false },
		]);
	});

	it("answers FORBIDDEN to the device account, leaving nothing", async () => {
		await using test = await household();
		await test.prepare.password(test.deviceAccount, PASSWORD);
		const kitchen = test.browser();
		expect((await kitchen.signIn("device@domus.invalid", PASSWORD)).status).toBe(200);

		expect(await answer(await subscribe(kitchen, pushSubscription("kitchen")))).toEqual({
			status: 403,
			body: expect.objectContaining({ code: "FORBIDDEN", status: 403 }),
		});
		expect(test.subscriptions()).toEqual([]);
	});

	it("answers BAD_REQUEST to a body that is not a push subscription", async () => {
		await using test = await household();
		const phone = await signedIn(test, "paco");
		const { endpoint } = pushSubscription("phone");

		for (const body of [
			"not json",
			[],
			{ endpoint },
			{ endpoint, keys: { p256dh: "k" } },
			{ endpoint, keys: { p256dh: "k", auth: "" } },
			{ endpoint: 7, keys: { p256dh: "k", auth: "a" } },
			{ ...pushSubscription("phone"), expirationTime: null },
		])
			expect(await answer(await subscribe(phone, body))).toEqual({
				status: 400,
				body: expect.objectContaining({ code: "BAD_REQUEST" }),
			});
		expect(test.subscriptions()).toEqual([]);
	});

	it("answers BAD_REQUEST with push-endpoint-not-allowed to a service off the list", async () => {
		await using test = await household();
		const phone = await signedIn(test, "paco");

		for (const endpoint of [
			"https://push.evil.test/send/1",
			"https://fcm.googleapis.com.evil.test/send/1",
			"http://fcm.googleapis.com/fcm/send/1",
			"https://fcm.googleapis.com:8443/fcm/send/1",
		])
			expect(
				await answer(
					await subscribe(phone, { endpoint, keys: { p256dh: "k", auth: "a" } }),
				),
			).toEqual({
				status: 400,
				body: expect.objectContaining({
					code: "BAD_REQUEST",
					data: { reason: "push-endpoint-not-allowed" },
				}),
			});
		expect(test.subscriptions()).toEqual([]);
	});
});

describe("unsubscribing", () => {
	it("deletes the device's subscription of this session and answers 204, also when there is none", async () => {
		await using test = await household();
		const phone = await signedIn(test, "paco");
		await subscribe(phone, pushSubscription("phone"));

		expect(await answer(await unsubscribe(phone))).toEqual({ status: 204, body: null });
		expect(test.subscriptions()).toEqual([]);
		expect(await answer(await unsubscribe(phone))).toEqual({ status: 204, body: null });
	});

	it("leaves the subscription of another session of the device", async () => {
		await using test = await household();
		const laptop = await signedIn(test, "paco");
		const paco = copyOf(test, laptop);
		await enter(laptop, "rocio");
		await subscribe(laptop, pushSubscription("laptop"));

		expect(await answer(await unsubscribe(paco))).toEqual({ status: 204, body: null });
		expect(subscribers(test)).toEqual([
			{ account: "rocio", endpoint: pushSubscription("laptop").endpoint, enabled: true },
		]);
	});
});

describe("the session a device has enabled", () => {
	it("stops being Paco's when Rocío signs in on the browser without subscribing, and stays so when she signs out", async () => {
		await using test = await household();
		const laptop = await signedIn(test, "paco");
		const paco = copyOf(test, laptop);
		await subscribe(laptop, pushSubscription("laptop"));

		await enter(laptop, "rocio");
		expect(subscribers(test)).toEqual([]);
		expect(await answer(await subscribe(paco, pushSubscription("laptop")))).toEqual(notEnabled);

		expect((await laptop.signOut()).status).toBe(200);
		expect(await answer(await subscribe(paco, pushSubscription("laptop")))).toEqual(notEnabled);
		expect(test.subscriptions()).toEqual([]);
	});

	it("answers CONFLICT to the device's earlier session and leaves the current subscription as it was", async () => {
		await using test = await household();
		const laptop = await signedIn(test, "paco");
		const paco = copyOf(test, laptop);
		await enter(laptop, "rocio");
		await subscribe(laptop, pushSubscription("rocio"));
		const current = test.subscriptions();

		expect(await answer(await subscribe(paco, pushSubscription("paco")))).toEqual(notEnabled);
		expect(await answer(await subscribe(paco, pushSubscription("rocio")))).toEqual(notEnabled);
		expect(test.subscriptions()).toEqual(current);
	});

	it("leaves the device with none when a session's creation fails after writing its entry", async () => {
		let failing = false;
		await using test = await household({
			interleave: (point) => {
				if (point === "entering" && failing) throw new Error("the creation fails here");
			},
		});
		const laptop = await signedIn(test, "paco");
		const paco = copyOf(test, laptop);
		await subscribe(laptop, pushSubscription("laptop"));

		failing = true;
		expect((await laptop.signIn("rocio@domus.test", PASSWORD)).status).not.toBe(200);
		failing = false;

		// No session of the device matches its entry: Paco's subscription is there, and not enabled.
		expect(subscribers(test)).toEqual([
			{ account: "paco", endpoint: pushSubscription("laptop").endpoint, enabled: false },
		]);
		expect(await answer(await subscribe(paco, pushSubscription("laptop")))).toEqual(notEnabled);
	});

	describe("with two sign-ins on the same device at once, only the last to write its entry may subscribe", () => {
		/**
		 * Signs Paco and Rocío in on copies of one device: `first` writes its entry and waits at `entering` until
		 * the other sign-in has ended.
		 */
		async function bothEnter(first: Person) {
			let holding = false;
			const reached = resolvable();
			const released = resolvable();
			const test = await household({
				interleave: (point) => {
					if (point !== "entering" || !holding) return;
					holding = false;
					reached.resolve();
					return released.promise;
				},
			});
			// A device exists once a first session entered it: an earlier sign-in by Paco, before the hold.
			const device = (await signedIn(test, "paco")).cookie(DEVICE_COOKIE) ?? "";
			const browsers = { paco: test.browser(), rocio: test.browser() };
			for (const browser of Object.values(browsers)) browser.setCookie(DEVICE_COOKIE, device);
			const second: Person = first === "paco" ? "rocio" : "paco";

			holding = true;
			const firstSignIn = browsers[first].signIn(`${first}@domus.test`, PASSWORD);
			await reached.promise;
			await enter(browsers[second], second);
			released.resolve();
			expect((await firstSignIn).status).toBe(200);
			for (const browser of Object.values(browsers))
				expect(browser.cookie(SESSION_COOKIE)).toBeDefined();
			return { test, browsers, first, second };
		}

		for (const order of ["paco", "rocio"] as const)
			it(`with ${order} entering first`, async () => {
				const { test, browsers, first, second } = await bothEnter(order);
				await using _ = test;

				// The first to start wrote its entry first, so the second one wrote the last.
				expect(
					await answer(await subscribe(browsers[first], pushSubscription(first))),
				).toEqual(notEnabled);
				expect((await subscribe(browsers[second], pushSubscription(second))).status).toBe(
					200,
				);
				expect(subscribers(test)).toEqual([
					{
						account: second,
						endpoint: pushSubscription(second).endpoint,
						enabled: true,
					},
				]);
			});
	});

	it("ends its subscription with the session when it is revoked", async () => {
		await using test = await household();
		const phone = await signedIn(test, "paco");
		const laptop = await signedIn(test, "paco");
		await subscribe(laptop, pushSubscription("laptop"));
		const fromPhone = test.contextOf(phone);
		const { session = "" } = test.contextOf(laptop);
		const { proof } = await test.requestProof(fromPhone, PASSWORD, {
			action: "platform.revokeSession",
			input: { session },
		});

		test.revokeSession(fromPhone, session, { idempotencyKey: "r1", proof });

		expect(test.subscriptions()).toEqual([]);
	});
});

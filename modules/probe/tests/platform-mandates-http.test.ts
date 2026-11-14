// The operations of the platform with a key and a mandate (ADR 0030): Kira reads and undoes a person's own entries
// in the action log within the delegation in force, and nothing else of the platform; every other surface, the
// routes of Hono and of Better Auth included, refuses a good key with a good mandate. Kira never confirms.
// Mandates are issued by the platform's real function from a test browser's session; Kira's calls go through the
// same `clientFor` and `fetch` as `assistant`, straight to the door, without the browser's cookies.
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

const PASSWORD = "correct horse battery staple";

/** The contracts Kira calls: the platform's and probe's. */
const contract = { ...platformContract, probe: probeContract };

const unauthorized = { code: "UNAUTHORIZED" };
const forbidden = { code: "FORBIDDEN" };

/** A platform with probe, and Ana and Luis, members with a password. */
async function household() {
	const test = createTestPlatform({ modules: [probe] });
	for (const id of ["ana", "luis"]) {
		test.prepare.account({ id, role: "member" });
		await test.prepare.password(id, PASSWORD);
	}
	return test;
}

/** A browser of `account`, signed in with {@link PASSWORD}. */
async function signedIn(test: TestPlatform, account: string) {
	const browser = test.browser();
	expect((await browser.signIn(`${account}@domus.test`, PASSWORD)).status).toBe(200);
	return browser;
}

/** The headers of Kira with its key and a mandate, as `assistant` sends them. */
const kiraHeaders = (key: string, mandate: string) => ({
	authorization: `Bearer ${key}`,
	"domus-mandate": mandate,
});

/** Kira's client on the door with its key and a mandate: never a browser's cookie. */
function kiraWith(test: TestPlatform, key: string, mandate: string) {
	return clientFor(contract, {
		baseUrl: TEST_ORIGIN,
		fetch: test.door.fetch,
		headers: kiraHeaders(key, mandate),
	});
}

/** Kira's client with a new key and a mandate of `browser`'s session. */
function kiraOf(test: TestPlatform, browser: TestBrowser) {
	return kiraWith(test, test.prepare.key("kira"), test.mandate(browser));
}

/** The client of the app, in a signed-in browser with its cookies. */
function app(browser: TestBrowser) {
	return clientFor(contract, { baseUrl: TEST_ORIGIN, fetch: browser.fetch });
}

/** A write's call options with its idempotency key. */
const keyed = (idempotencyKey: string) => ({ context: { idempotencyKey } });

/** The code of what a call threw, or `"ok"` when it went through. */
async function outcome(call: () => Promise<unknown>): Promise<string> {
	try {
		await call();
		return "ok";
	} catch (error) {
		return String((error as { code?: unknown }).code);
	}
}

describe("log/read via Kira", () => {
	it("answers only the person's annotations, within the delegation in force", async () => {
		await using test = await household();
		const ana = await signedIn(test, "ana");
		await app(ana).probe.addNote({ body: "pan" }, keyed("k1"));
		await app(await signedIn(test, "luis")).probe.addNote({ body: "secreto" }, keyed("k1"));
		const kira = kiraOf(test, ana);

		const seen: Record<string, string> = {};
		for (const value of ["no", "yes", "confirm"] as const) {
			test.prepare.delegation("ana", "platform", "read", value);
			seen[value] = await outcome(() => kira.log.read());
		}
		expect(seen).toEqual({ no: "FORBIDDEN", yes: "ok", confirm: "CONFIRMATION_REQUIRED" });

		test.prepare.delegation("ana", "platform", "read", "yes");
		expect(await kira.log.read()).toEqual(await app(ana).log.read());
		expect(await kira.log.read()).toMatchObject([
			{ entry: 1, action: "probe.addNote", actor: { account: "ana" } },
		]);
	});
});

describe("log/undo via Kira", () => {
	it("undoes a write of the person within the delegation in force, logged via kira, and never another's", async () => {
		await using test = await household();
		test.prepare.delegation("ana", "probe", "write", "yes");
		const ana = await signedIn(test, "ana");
		await app(ana).probe.addNote({ body: "pan" }, keyed("k1"));
		await app(await signedIn(test, "luis")).probe.addNote({ body: "secreto" }, keyed("k1"));
		const kira = kiraOf(test, ana);

		expect(await kira.log.undo({ entry: 1 }, keyed("u1"))).toEqual({
			result: { id: 1, body: "pan" },
			entry: 3,
		});
		expect(await kira.log.undo({ entry: 1 }, keyed("u1"))).toEqual({
			entry: 3,
			repeated: true,
		});
		await expect(kira.log.undo({ entry: 2 }, keyed("u2"))).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
		expect(test.log()).toMatchObject([
			{ entry: 1, undoneBy: 3 },
			{ entry: 2, undoneBy: null },
			{ entry: 3, undoes: 1, actor: { account: "ana", via: "kira" } },
		]);
		expect(await app(ana).probe.listNotes()).toEqual([]);
	});

	it("is denied once the delegation of the area is withdrawn, though the write was from before", async () => {
		await using test = await household();
		test.prepare.delegation("ana", "probe", "write", "yes");
		const ana = await signedIn(test, "ana");
		const kira = kiraOf(test, ana);
		await kira.probe.addNote({ body: "leche" }, keyed("k1"));

		test.prepare.delegation("ana", "probe", "write", "no");
		await expect(kira.log.undo({ entry: 1 }, keyed("u1"))).rejects.toMatchObject(forbidden);
		expect(test.log()).toMatchObject([{ entry: 1, undoneBy: null }]);
		expect(await app(ana).probe.listNotes()).toEqual([{ id: 1, body: "leche", files: [] }]);

		// The person undoes it by the app, where no delegation applies.
		expect(await app(ana).log.undo({ entry: 1 }, keyed("u1"))).toMatchObject({ entry: 2 });
		expect(await app(ana).probe.listNotes()).toEqual([]);
	});
});

describe("a pending confirmation via Kira", () => {
	/** Asks Kira to add a note the delegation makes it confirm, and returns the pending confirmation's id. */
	async function pendingOf(kira: ReturnType<typeof kiraWith>, idempotencyKey: string) {
		const error: unknown = await kira.probe
			.addNote({ body: "leche" }, keyed(idempotencyKey))
			.then(
				() => undefined,
				(thrown: unknown) => thrown,
			);
		expect(error).toMatchObject({ code: "CONFIRMATION_REQUIRED" });
		return (error as { data: { confirmation: string } }).data.confirmation;
	}

	it("is never confirmed with a mandate: it stays unconsumed, and the app confirms it later", async () => {
		await using test = await household();
		test.prepare.delegation("ana", "probe", "write", "confirm");
		const ana = await signedIn(test, "ana");
		const kira = kiraOf(test, ana);
		const pending = await pendingOf(kira, "k1");
		const stored = test.pendingConfirmations();

		await expect(kira.confirmations.confirm({ id: pending })).rejects.toMatchObject(
			unauthorized,
		);
		expect(test.pendingConfirmations()).toEqual(stored);
		expect(test.log()).toEqual([]);

		expect(await app(ana).confirmations.confirm({ id: pending })).toEqual({
			result: { id: 1, body: "leche" },
			entry: 1,
		});
	});

	it("is never rejected with a mandate: it stays, and the app rejects it later", async () => {
		await using test = await household();
		test.prepare.delegation("ana", "probe", "write", "confirm");
		const ana = await signedIn(test, "ana");
		const kira = kiraOf(test, ana);
		const pending = await pendingOf(kira, "k1");
		const stored = test.pendingConfirmations();

		await expect(kira.confirmations.reject({ id: pending })).rejects.toMatchObject(
			unauthorized,
		);
		expect(test.pendingConfirmations()).toEqual(stored);

		await app(ana).confirmations.reject({ id: pending });
		await expect(app(ana).confirmations.confirm({ id: pending })).rejects.toMatchObject({
			code: "CONFLICT",
		});
		expect(test.log()).toEqual([]);
	});
});

/** Every procedure of `router` by its path, `<group>/<name>`, as the door serves it. */
function pathsOf(router: object, prefix = ""): string[] {
	return Object.entries(router).flatMap(([name, value]: [string, object]) =>
		"~orpc" in value ? [`${prefix}${name}`] : pathsOf(value, `${prefix}${name}/`),
	);
}

/** A request to a route of Hono or of Better Auth at `path`, with Kira's `headers` and a JSON body when given. */
function route(
	path: string,
	headers: Record<string, string>,
	method = "GET",
	body?: unknown,
): Request {
	return new Request(new URL(path, TEST_ORIGIN), {
		method,
		headers: {
			...headers,
			...(body === undefined ? {} : { "content-type": "application/json" }),
		},
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});
}

describe("every other surface with a good key and a good mandate", () => {
	/** Paco, the admin, signed in, with every level of probe and of the platform delegated, and Kira for him. */
	async function delegatingAdmin() {
		const test = createTestPlatform({ modules: [probe] });
		test.prepare.account({ id: "paco", role: "admin" });
		await test.prepare.password("paco", PASSWORD);
		for (const area of ["probe", "platform"])
			for (const level of ["read", "write", "manage"] as const)
				test.prepare.delegation("paco", area, level, "yes");
		const browser = await signedIn(test, "paco");
		const key = test.prepare.key("kira");
		const mandate = test.mandate(browser);
		return { test, browser, key, mandate, kira: kiraWith(test, key, mandate) };
	}

	it("refuses every operation of the platform outside the list, and changes nothing", async () => {
		const { test, browser, kira } = await delegatingAdmin();
		await using _ = test;
		const session = test.contextOf(browser).session ?? "";
		const delegation = await app(browser).delegation.read({ account: "paco" });
		const tasks = await app(browser).tasks.list();
		const pending = "an-unknown-pending-confirmation";
		const cleanup = { task: "cleanup" };

		const calls: Record<string, () => Promise<unknown>> = {
			"password/change": () =>
				kira.password.change({ currentPassword: PASSWORD, newPassword: `${PASSWORD} 2` }),
			"sessions/list": () => kira.sessions.list(),
			"sessions/revoke": () => kira.sessions.revoke({ session }, keyed("s1")),
			"devices/revoke": () => kira.devices.revoke({ session }, keyed("d1")),
			"confirmations/confirm": () => kira.confirmations.confirm({ id: pending }),
			"confirmations/reject": () => kira.confirmations.reject({ id: pending }),
			"proofs/request": () =>
				kira.proofs.request({
					password: PASSWORD,
					operation: { action: "probe.configure", input: { visibility: "public" } },
				}),
			"permissions/set": () =>
				kira.permissions.set(
					{ account: "paco", area: "probe", level: "read" },
					keyed("p1"),
				),
			"delegation/read": () => kira.delegation.read({ account: "paco" }),
			"delegation/set": () =>
				kira.delegation.set(
					{ account: "paco", area: "probe", level: "read", value: "no" },
					keyed("g1"),
				),
			"notifications/test": () => kira.notifications.test(undefined, keyed("n1")),
			"tasks/list": () => kira.tasks.list(),
			"tasks/setTime": () => kira.tasks.setTime({ ...cleanup, time: "06:00" }, keyed("t1")),
			"tasks/pause": () => kira.tasks.pause(cleanup, keyed("t2")),
			"tasks/resume": () => kira.tasks.resume(cleanup, keyed("t3")),
			"tasks/launch": () => kira.tasks.launch(cleanup, keyed("t4")),
		};
		// Every operation of the platform is here, in the list, or `status`: one added tomorrow fails until it is.
		expect(Object.keys(calls).sort()).toEqual(
			pathsOf(platformContract)
				.filter((path) => !["status", "log/read", "log/undo"].includes(path))
				.sort(),
		);

		const seen: Record<string, string> = {};
		for (const [path, call] of Object.entries(calls)) seen[path] = await outcome(call);
		expect(seen).toEqual(
			Object.fromEntries(Object.keys(calls).map((path) => [path, "UNAUTHORIZED"])),
		);

		// The mandate was good all along, and nothing changed.
		expect(await kira.log.read()).toEqual([]);
		expect(test.log()).toEqual([]);
		expect(test.hasSession(session)).toBe(true);
		expect(await app(browser).delegation.read({ account: "paco" })).toEqual(delegation);
		expect(await app(browser).tasks.list()).toEqual(tasks);
		expect((await browser.signIn("paco@domus.test", PASSWORD)).status).toBe(200);
	});

	it("refuses uploading, downloading, the live channel, the key of VAPID, the subscriptions and Better Auth, in each one's form of errors", async () => {
		const { test, browser, key, mandate } = await delegatingAdmin();
		await using _ = test;
		const session = test.contextOf(browser).session ?? "";
		const headers = kiraHeaders(key, mandate);

		const upload = new Request(new URL("/api/files", TEST_ORIGIN), {
			method: "POST",
			body: new Uint8Array([0xff, 0xd8, 0xff]),
			headers: { ...headers, "content-length": "3", "x-file-name": "foto.jpg" },
		});
		for (const request of [
			upload,
			route("/api/files/download", headers, "POST", {
				action: "probe.getNote",
				input: { id: 1 },
				file: "f",
			}),
			route("/api/events", headers),
			route("/api/notifications/key", headers),
			route("/api/notifications/subscription", headers, "PUT", {
				endpoint: "https://fcm.googleapis.com/fcm/send/paco",
				keys: { p256dh: "p256dh-paco", auth: "auth-paco" },
			}),
			route("/api/notifications/subscription", headers, "DELETE"),
			route("/api/auth/sign-in/email", headers, "POST", {
				email: "paco@domus.test",
				password: PASSWORD,
			}),
			route("/api/auth/sign-out", headers, "POST", {}),
		]) {
			const response = await test.door.fetch(request);
			const path = new URL(request.url).pathname;
			expect({ path, status: response.status }).toEqual({ path, status: 401 });
			expect(await response.json()).toMatchObject(unauthorized);
			expect(response.headers.getSetCookie()).toEqual([]);
		}

		expect(test.hasSession(session)).toBe(true);
		expect(test.subscriptions()).toEqual([]);
		expect(test.log()).toEqual([]);
	});
});

// The operations of the platform with a key and a mandate (ADR 0030, ADR 0034): the door lets the mandate reach each
// one, and authorization denies every one but reading and undoing in the log, which it lets a context with `via` reach
// within the delegation; the routes of Hono and of Better Auth refuse a good key with a good mandate. What a context
// with `via` reaches is proved over the synthetic context, in `log`, `confirmations` and `proofs`.
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

	it("lets authorization deny every operation of the platform but reading and undoing in the log, and changes nothing", async () => {
		const { test, browser, kira } = await delegatingAdmin();
		await using _ = test;
		const session = test.contextOf(browser).session ?? "";
		// A device the admin may revoke: one of the device account's, which the operation finds before authorization.
		const kitchen = test.prepare.session(test.deviceAccount).session ?? "";
		const delegation = await app(browser).delegation.read({ account: "paco" });
		const tasks = await app(browser).tasks.list();
		const pending = "an-unknown-pending-confirmation";
		const cleanup = { task: "cleanup" };

		const calls: Record<string, () => Promise<unknown>> = {
			"password/change": () =>
				kira.password.change({ currentPassword: PASSWORD, newPassword: `${PASSWORD} 2` }),
			"sessions/list": () => kira.sessions.list(),
			"sessions/revoke": () => kira.sessions.revoke({ session }, keyed("s1")),
			"devices/revoke": () => kira.devices.revoke({ session: kitchen }, keyed("d1")),
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
		// Every operation of the platform is here, reading and undoing in the log, or `status`: one added tomorrow fails
		// until it is.
		expect(Object.keys(calls).sort()).toEqual(
			pathsOf(platformContract)
				.filter((path) => !["status", "log/read", "log/undo"].includes(path))
				.sort(),
		);

		const seen: Record<string, string> = {};
		for (const [path, call] of Object.entries(calls)) seen[path] = await outcome(call);
		expect(seen).toEqual(
			Object.fromEntries(Object.keys(calls).map((path) => [path, "FORBIDDEN"])),
		);

		// The mandate was good all along, and nothing changed.
		expect(await kira.log.read()).toEqual([]);
		expect(test.log()).toEqual([]);
		expect(test.hasSession(session)).toBe(true);
		expect(test.hasSession(kitchen)).toBe(true);
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

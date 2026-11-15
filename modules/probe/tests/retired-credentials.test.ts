// The credentials of the connected apps are retired (ADR 0034): a request to `/api` that carries `Authorization`,
// with any value, or the header of a mandate is refused with `UNAUTHORIZED` before the door looks at the cookie,
// `status` and Better Auth's routes included, never taken as no credential. Each family of routes answers in its own
// form of errors: the RPC envelope, the plain JSON of the routes of Hono and Better Auth's own. Without those headers
// the door does what it always did. `/health` and the built web app are checked in the tests of `apps/api`.
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

/** The contracts the app calls: the platform's and probe's. */
const contract = { ...platformContract, probe: probeContract };

/** Something with a `fetch` of the door: the door itself, or a test browser with its cookies. */
interface Fetcher {
	readonly fetch: (request: Request) => Promise<Response>;
}

/** A value a test can find in any answer: none ever repeats it. */
const SECRET = "a-retired-credential-of-the-tests";

/** Each retired credential, by name: `Authorization` with `Bearer`, with another scheme and empty, and the mandate. */
const RETIRED: Readonly<Record<string, Readonly<Record<string, string>>>> = {
	bearer: { authorization: `Bearer ${SECRET}` },
	"another scheme": { authorization: `Basic ${SECRET}` },
	"empty authorization": { authorization: "" },
	mandate: { "domus-mandate": SECRET },
};

/** A platform with probe and Ana, a member with a password, and Ana's browser, signed in. */
async function anaSignedIn() {
	const test = createTestPlatform({ modules: [probe] });
	test.prepare.account({ id: "ana", role: "member" });
	await test.prepare.password("ana", PASSWORD);
	const browser = test.browser();
	expect((await browser.signIn("ana@domus.test", PASSWORD)).status).toBe(200);
	return { test, browser };
}

/** `through`, with `headers` set on every request it sends, keeping the text of every answer it got. */
function carrying(through: Fetcher, headers: Readonly<Record<string, string>>) {
	const answers: string[] = [];
	const fetch = async (request: Request) => {
		const sent = new Headers(request.headers);
		for (const [name, value] of Object.entries(headers)) sent.set(name, value);
		const response = await through.fetch(new Request(request, { headers: sent }));
		answers.push(await response.clone().text());
		return response;
	};
	return { fetch, answers };
}

/** A request to a route of Hono or of Better Auth at `path`, with a JSON body when given. */
function route(path: string, method = "GET", body?: unknown): Request {
	return new Request(new URL(path, TEST_ORIGIN), {
		method,
		...(body === undefined
			? {}
			: { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
	});
}

/** Uploading a small JPEG. */
const upload = () =>
	new Request(new URL("/api/files", TEST_ORIGIN), {
		method: "POST",
		body: new Uint8Array([0xff, 0xd8, 0xff]),
		headers: { "content-length": "3", "x-file-name": "foto.jpg" },
	});

/** The routes of Hono: uploading and downloading files and the live channel. */
const honoRoutes = (): readonly Request[] => [
	upload(),
	route("/api/files/download", "POST", { action: "probe.getNote", input: { id: 1 }, file: "f" }),
	route("/api/events"),
];

/** Everything about an answer a test compares: its status and its body. */
async function seen(response: Response) {
	return { status: response.status, body: (await response.json()) as unknown };
}

/** Every refused call of oRPC: what it threw, by its code and status. */
async function refusedCall(call: () => Promise<unknown>) {
	try {
		await call();
		return "answered";
	} catch (error) {
		const { code, status } = error as { code?: unknown; status?: unknown };
		return { code, status };
	}
}

const unauthorized = { code: "UNAUTHORIZED", status: 401 };

describe("a retired credential at the door", () => {
	for (const [name, headers] of Object.entries(RETIRED)) {
		describe(`${name}`, () => {
			for (const withCookie of [false, true]) {
				const alone = withCookie ? "next to a session that lives" : "alone";

				it(`is refused on an action of probe, an operation of the platform and status, ${alone}`, async () => {
					const { test, browser } = await anaSignedIn();
					await using _ = test;
					const sent = carrying(withCookie ? browser : test.door, headers);
					const client = clientFor(contract, { baseUrl: TEST_ORIGIN, fetch: sent.fetch });

					for (const call of [
						() => client.status(),
						() => client.probe.listNotes(),
						() =>
							client.probe.addNote(
								{ body: "leche" },
								{ context: { idempotencyKey: "k1" } },
							),
						() => client.sessions.list(),
						() => client.log.read(),
					])
						expect(await refusedCall(call)).toEqual(unauthorized);

					expect(await clientFor(contract, browserOf(browser)).probe.listNotes()).toEqual(
						[],
					);
					expect(test.log()).toEqual([]);
					for (const text of sent.answers) expect(text).not.toContain(SECRET);
				});

				it(`is refused on uploading, downloading and the live channel, in their form of errors, ${alone}`, async () => {
					const { test, browser } = await anaSignedIn();
					await using _ = test;
					const sent = carrying(withCookie ? browser : test.door, headers);
					// The same requests with no credential at all: the form of errors of these routes.
					const without = [];
					for (const request of honoRoutes())
						without.push(await seen(await test.door.fetch(request)));

					const refused = [];
					for (const request of honoRoutes())
						refused.push(await seen(await sent.fetch(request)));

					expect(refused).toEqual(without);
					expect(refused.map(({ status }) => status)).toEqual([401, 401, 401]);
					for (const text of sent.answers) expect(text).not.toContain(SECRET);
				});

				it(`signs nobody in or out, in Better Auth's form of errors, ${alone}`, async () => {
					const { test, browser } = await anaSignedIn();
					await using _ = test;
					const session = test.contextOf(browser).session ?? "";
					const stranger = test.browser();
					const sent = carrying(withCookie ? browser : stranger, headers);

					const signIn = await sent.fetch(
						route("/api/auth/sign-in/email", "POST", {
							email: "ana@domus.test",
							password: PASSWORD,
						}),
					);
					const signOut = await sent.fetch(route("/api/auth/sign-out", "POST", {}));

					const wrongPassword = await test
						.browser()
						.signIn("ana@domus.test", "a wrong password");
					const wrongKeys = Object.keys((await wrongPassword.json()) as object).sort();
					for (const response of [signIn, signOut]) {
						expect(response.status).toBe(401);
						expect(response.headers.getSetCookie()).toEqual([]);
						const body = (await response.json()) as object;
						expect(body).toMatchObject({ code: "UNAUTHORIZED" });
						expect(Object.keys(body).sort()).toEqual(wrongKeys);
					}
					expect(stranger.cookie(SESSION_COOKIE)).toBeUndefined();
					expect(test.hasSession(session)).toBe(true);
					for (const text of sent.answers) expect(text).not.toContain(SECRET);
				});
			}
		});
	}
});

describe("without a retired credential", () => {
	it("answers status without saying which app calls, with no session and with one", async () => {
		const { test, browser } = await anaSignedIn();
		await using _ = test;
		const expected = { service: "domus", protocol: PROTOCOL };

		expect(
			await clientFor(contract, { baseUrl: TEST_ORIGIN, fetch: test.door.fetch }).status(),
		).toStrictEqual(expected);
		expect(await clientFor(contract, browserOf(browser)).status()).toStrictEqual(expected);
	});

	it("lets a session read and write as before", async () => {
		const { test, browser } = await anaSignedIn();
		await using _ = test;
		const client = clientFor(contract, browserOf(browser));

		await client.probe.addNote({ body: "leche" }, { context: { idempotencyKey: "k1" } });

		expect(await client.probe.listNotes()).toMatchObject([{ body: "leche" }]);
		expect(await client.sessions.list()).toHaveLength(1);
		expect(test.log()).toMatchObject([{ actor: { account: "ana" }, action: "probe.addNote" }]);
	});
});

/** The transport of a client in `browser`, with its cookies. */
function browserOf(browser: TestBrowser): { baseUrl: string; fetch: TestBrowser["fetch"] } {
	return { baseUrl: TEST_ORIGIN, fetch: browser.fetch };
}

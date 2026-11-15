// Kira acts on someone's behalf with its key and a mandate (ADR 0030): the door seals the context the mandate keeps,
// with `via` the key's app and the channel `contexto`, and the delegation table of that person decides. Mandates
// are issued here by the platform's real function, from the session of a test browser; Kira's calls go through the
// same `clientFor` and `fetch` as `assistant`, straight to the door, without the browser's cookies. Only the mechanism
// is here; what authorization owes any agent is proved over the synthetic context with `via`, in `delegation`,
// `proofs`, `log`, `idempotency` and `confirmations` (ADR 0034).
import { randomBytes } from "node:crypto";

import { clientFor } from "@domus/api-client";
import {
	createTestPlatform,
	platformContract,
	TEST_ORIGIN,
	type TestPlatform,
} from "@domus/test-utils";
import { describe, expect, it } from "vitest";

import { probeContract } from "../contracts";
import probe from "../server";

const PASSWORD = "correct horse battery staple";

/** A mandate's life unless a test gives another: 15 minutes. */
const LIFE = 15 * 60 * 1000;

/** The contracts Kira calls: the platform's and probe's. */
const contract = { ...platformContract, probe: probeContract };

const unauthorized = { code: "UNAUTHORIZED" };
const forbidden = { code: "FORBIDDEN" };

/** A platform with probe and Ana, a member with a password. */
async function probeWithAna(
	options: { readonly mandateLife?: number; readonly apps?: readonly string[] } = {},
) {
	const test = createTestPlatform({ modules: [probe], ...options });
	test.prepare.account({ id: "ana", role: "member" });
	await test.prepare.password("ana", PASSWORD);
	return test;
}

/** A browser of `account`, signed in with {@link PASSWORD}. */
async function signedIn(test: TestPlatform, account: string) {
	const browser = test.browser();
	expect((await browser.signIn(`${account}@domus.test`, PASSWORD)).status).toBe(200);
	return browser;
}

/** Kira's client on the door, with `headers` as `assistant` sends them: never a browser's cookie. */
function kira(test: TestPlatform, headers: Record<string, string>) {
	return clientFor(contract, { baseUrl: TEST_ORIGIN, fetch: test.door.fetch, headers });
}

/** Kira's client with its key and a mandate. */
function kiraWith(test: TestPlatform, key: string, mandate: string) {
	return kira(test, { authorization: `Bearer ${key}`, "domus-mandate": mandate });
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

describe("Kira with a mandate", () => {
	it("reads and writes probe on the person's behalf, logged with the account and via kira, never a credential", async () => {
		await using test = await probeWithAna();
		test.prepare.delegation("ana", "probe", "read", "yes");
		test.prepare.delegation("ana", "probe", "write", "yes");
		const key = test.prepare.key("kira");
		const mandate = test.mandate(await signedIn(test, "ana"));
		const client = kiraWith(test, key, mandate);

		expect(await client.probe.addNote({ body: "leche" }, keyed("k1"))).toEqual({
			result: { id: 1, body: "leche" },
			entry: 1,
		});
		expect(await client.probe.listNotes()).toEqual([{ id: 1, body: "leche", files: [] }]);

		const log = test.log();
		expect(log).toMatchObject([{ actor: { account: "ana", via: "kira" } }]);
		const written = JSON.stringify(log);
		expect(written).not.toContain(key.slice(key.indexOf(".") + 1));
		expect(written).not.toContain(key.slice(0, key.indexOf(".")));
		expect(written).not.toContain(mandate);
	});

	it("answers unauthorized to a good key without a mandate, with a malformed one or an unknown one", async () => {
		await using test = await probeWithAna();
		const key = test.prepare.key("kira");
		const real = test.mandate(await signedIn(test, "ana"));
		const unknown = randomBytes(32).toString("base64url");

		for (const headers of [
			{ authorization: `Bearer ${key}` },
			{ authorization: `Bearer ${key}`, "domus-mandate": "" },
			{ authorization: `Bearer ${key}`, "domus-mandate": `${real}x` },
			{ authorization: `Bearer ${key}`, "domus-mandate": real.slice(1) },
			{ authorization: `Bearer ${key}`, "domus-mandate": unknown },
			// A mandate needs its key: alone it is no credential, and the action needs one.
			{ "domus-mandate": real },
		] as Record<string, string>[]) {
			const client = kira(test, headers);
			expect(await outcome(() => client.probe.listNotes())).toBe("UNAUTHORIZED");
			expect(await outcome(() => client.probe.addNote({ body: "leche" }, keyed("k1")))).toBe(
				"UNAUTHORIZED",
			);
		}
		expect(test.log()).toEqual([]);
		expect(await kiraWith(test, key, real).probe.listNotes()).toEqual([]);
	});

	it("answers unauthorized with a bad key, whatever the mandate", async () => {
		await using test = await probeWithAna();
		const key = test.prepare.key("kira");
		const mandate = test.mandate(await signedIn(test, "ana"));
		test.revokeKey(key.slice("domus_".length, key.indexOf(".")));

		await expect(kiraWith(test, key, mandate).probe.listNotes()).rejects.toMatchObject(
			unauthorized,
		);
	});

	it("answers unauthorized to a key and a good mandate next to the session cookie", async () => {
		await using test = await probeWithAna();
		const browser = await signedIn(test, "ana");
		const mixed = clientFor(contract, {
			baseUrl: TEST_ORIGIN,
			fetch: browser.fetch,
			headers: {
				authorization: `Bearer ${test.prepare.key("kira")}`,
				"domus-mandate": test.mandate(browser),
			},
		});

		await expect(mixed.probe.listNotes()).rejects.toMatchObject(unauthorized);
	});

	it("stops being good at the exact instant it expires, and works a millisecond before", async () => {
		await using test = await probeWithAna();
		const key = test.prepare.key("kira");
		const client = kiraWith(test, key, test.mandate(await signedIn(test, "ana")));

		test.clock.advance(LIFE - 1);
		expect(await client.probe.listNotes()).toEqual([]);
		test.clock.advance(1);
		await expect(client.probe.listNotes()).rejects.toMatchObject(unauthorized);
	});

	it("takes its life from the platform's options", async () => {
		await using test = await probeWithAna({ mandateLife: 1000 });
		const key = test.prepare.key("kira");
		const client = kiraWith(test, key, test.mandate(await signedIn(test, "ana")));

		test.clock.advance(999);
		expect(await client.probe.listNotes()).toEqual([]);
		test.clock.advance(1);
		await expect(client.probe.listNotes()).rejects.toMatchObject(unauthorized);
	});

	it("is good only with a key of the app it was issued for", async () => {
		await using test = await probeWithAna({ apps: ["tester"] });
		const browser = await signedIn(test, "ana");
		const mandate = test.mandate(browser);

		await expect(
			kiraWith(test, test.prepare.key("tester"), mandate).probe.listNotes(),
		).rejects.toMatchObject(unauthorized);
		expect(await kiraWith(test, test.prepare.key("kira"), mandate).probe.listNotes()).toEqual(
			[],
		);
		expect(() => test.mandate(browser, { app: "tester" })).toThrow(
			'connected app "tester" receives no mandates',
		);
		expect(() => test.mandate(browser, { app: "nobody" })).toThrow(
			'connected app "nobody" receives no mandates',
		);
	});

	it("is issued only from a session that lives", async () => {
		await using test = await probeWithAna();
		const browser = await signedIn(test, "ana");
		test.clock.set(test.sessionExpiresAt(test.contextOf(browser).session ?? "") ?? 0);

		expect(() => test.mandate(browser)).toThrow("the session of a mandate must live");
	});

	it("keeps the identity of its session: proven by password, a manage action asks for a proof, which authorization denies Kira", async () => {
		await using test = await probeWithAna();
		test.prepare.grant("ana", "probe", "manage");
		test.prepare.delegation("ana", "probe", "manage", "yes");
		const client = kiraWith(
			test,
			test.prepare.key("kira"),
			test.mandate(await signedIn(test, "ana")),
		);
		await client.probe.addNote({ body: "leche" }, keyed("k1"));

		// Proven otherwise than by password, authorization would deny it at once.
		await expect(
			client.probe.configure({ visibility: "public" }, keyed("k2")),
		).rejects.toMatchObject({ code: "STEP_UP_REQUIRED" });
		await expect(
			client.proofs.request({
				password: PASSWORD,
				operation: { action: "probe.configure", input: { visibility: "public" } },
			}),
		).rejects.toMatchObject(forbidden);
		expect(test.log()).toHaveLength(1);
	});
});

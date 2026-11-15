// Kira acts on someone's behalf with its key and a mandate (ADR 0030): the door seals the context the mandate keeps,
// with `via` the key's app and the channel `contexto`, and the delegation table of that person decides. Mandates
// are issued here by the platform's real function, from the session of a test browser; Kira's calls go through the
// same `clientFor` and `fetch` as `assistant`, straight to the door, without the browser's cookies.
import { randomBytes } from "node:crypto";
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

	it("keeps the identity of its session: proven by password, a manage action asks for a proof, which Kira cannot ask for", async () => {
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
		).rejects.toMatchObject(unauthorized);
		expect(test.log()).toHaveLength(1);
	});

	it("does not take a proof the person asked for in the app from the same session, which stays good for the app", async () => {
		await using test = await probeWithAna();
		test.prepare.grant("ana", "probe", "manage");
		test.prepare.delegation("ana", "probe", "manage", "yes");
		const browser = await signedIn(test, "ana");
		const client = kiraWith(test, test.prepare.key("kira"), test.mandate(browser));
		await client.probe.addNote({ body: "leche" }, keyed("k1"));
		const input = { visibility: "public" } as const;
		const { proof } = await app(browser).proofs.request({
			password: PASSWORD,
			operation: { action: "probe.configure", input },
		});

		await expect(
			client.probe.configure(input, { context: { idempotencyKey: "k2", proof } }),
		).rejects.toMatchObject({ code: "STEP_UP_REQUIRED" });
		expect(test.log()).toHaveLength(1);
		expect(
			await app(browser).probe.configure(input, { context: { idempotencyKey: "k3", proof } }),
		).toEqual({ result: { notes: 1 }, entry: 2 });
	});
});

describe("authorization via Kira", () => {
	it("applies the delegation's no, yes and confirm at each level", async () => {
		await using test = await probeWithAna();
		test.prepare.grant("ana", "probe", "manage");
		const client = kiraWith(
			test,
			test.prepare.key("kira"),
			test.mandate(await signedIn(test, "ana")),
		);
		const calls = {
			read: () => client.probe.listNotes(),
			write: () =>
				client.probe.addNote({ body: "leche" }, keyed(randomBytes(8).toString("hex"))),
			manage: () =>
				client.probe.configure(
					{ visibility: "public" },
					keyed(randomBytes(8).toString("hex")),
				),
		} as const;

		const seen: Record<string, string> = {};
		for (const level of ["read", "write", "manage"] as const)
			for (const value of ["no", "yes", "confirm"] as const) {
				test.prepare.delegation("ana", "probe", level, value);
				seen[`${level} ${value}`] = await outcome(calls[level]);
			}
		expect(seen).toEqual({
			"read no": "FORBIDDEN",
			"read yes": "ok",
			"read confirm": "CONFIRMATION_REQUIRED",
			"write no": "FORBIDDEN",
			"write yes": "ok",
			"write confirm": "CONFIRMATION_REQUIRED",
			"manage no": "FORBIDDEN",
			// A manage action delegated still needs its proof, which no mandate can bring.
			"manage yes": "STEP_UP_REQUIRED",
			"manage confirm": "CONFIRMATION_REQUIRED",
		});
	});

	it("never goes past the person's permission, whatever the delegation says", async () => {
		await using test = await probeWithAna();
		test.prepare.grant("ana", "probe", "read");
		test.prepare.delegation("ana", "probe", "write", "yes");
		const client = kiraWith(
			test,
			test.prepare.key("kira"),
			test.mandate(await signedIn(test, "ana")),
		);

		await expect(client.probe.addNote({ body: "leche" }, keyed("k1"))).rejects.toMatchObject(
			forbidden,
		);
		expect(test.log()).toEqual([]);
	});

	it("denies an area without a row: a module that arrives later is closed to Kira", async () => {
		const folder = mkdtempSync(join(tmpdir(), "domus-mandates-"));
		try {
			const file = join(folder, "domus.db");
			{
				await using before = createTestPlatform({ modules: [], file });
				before.prepare.account({ id: "ana", role: "member" });
				await before.prepare.password("ana", PASSWORD);
			}
			await using test = createTestPlatform({ modules: [probe], file });
			const client = kiraWith(
				test,
				test.prepare.key("kira"),
				test.mandate(await signedIn(test, "ana")),
			);

			await expect(client.probe.listNotes()).rejects.toMatchObject(forbidden);
			// Without via, the person's own permission in the new area applies.
			expect(await app(await signedIn(test, "ana")).probe.listNotes()).toEqual([]);
		} finally {
			rmSync(folder, { recursive: true, force: true });
		}
	});

	it("leaves a write it must confirm pending, which the person confirms by the app from another session, with the delegation of then", async () => {
		await using test = await probeWithAna();
		test.prepare.delegation("ana", "probe", "write", "confirm");
		const client = kiraWith(
			test,
			test.prepare.key("kira"),
			test.mandate(await signedIn(test, "ana")),
		);
		const pending = await client.probe.addNote({ body: "leche" }, keyed("k1")).then(
			() => expect.fail("the write went through"),
			(error: { code?: string; data?: { confirmation?: string } }) => {
				expect(error.code).toBe("CONFIRMATION_REQUIRED");
				return error.data?.confirmation ?? "";
			},
		);
		expect(test.log()).toEqual([]);
		const phone = app(await signedIn(test, "ana"));

		test.prepare.delegation("ana", "probe", "write", "no");
		await expect(phone.confirmations.confirm({ id: pending })).rejects.toMatchObject(forbidden);
		test.prepare.delegation("ana", "probe", "write", "confirm");
		expect(await phone.confirmations.confirm({ id: pending })).toEqual({
			result: { id: 1, body: "leche" },
			entry: 1,
		});
		expect(test.log()).toMatchObject([{ actor: { account: "ana", via: "kira" } }]);
	});

	it("keeps the same idempotency key apart from the app's, and acknowledges a repeat with another mandate of the person", async () => {
		await using test = await probeWithAna();
		const key = test.prepare.key("kira");
		const browser = await signedIn(test, "ana");
		const first = kiraWith(test, key, test.mandate(browser));
		const second = kiraWith(test, key, test.mandate(await signedIn(test, "ana")));

		expect(await app(browser).probe.addNote({ body: "pan" }, keyed("k1"))).toEqual({
			result: { id: 1, body: "pan" },
			entry: 1,
		});
		expect(await first.probe.addNote({ body: "leche" }, keyed("k1"))).toEqual({
			result: { id: 2, body: "leche" },
			entry: 2,
		});
		expect(await second.probe.addNote({ body: "leche" }, keyed("k1"))).toEqual({
			entry: 2,
			repeated: true,
		});
		expect(await app(browser).probe.listNotes()).toHaveLength(2);
	});

	it("hides another's private record, and answers forbidden to what the delegation denies", async () => {
		await using test = await probeWithAna();
		test.prepare.account({ id: "luis", role: "member" });
		await test.prepare.password("luis", PASSWORD);
		const luis = app(await signedIn(test, "luis"));
		await luis.probe.addNote({ body: "secreto" }, keyed("k1"));
		const client = kiraWith(
			test,
			test.prepare.key("kira"),
			test.mandate(await signedIn(test, "ana")),
		);

		expect(await client.probe.listNotes()).toEqual([]);
		expect(await client.probe.getNote({ id: 1 })).toBeNull();
		await expect(
			client.probe.editNote({ id: 1, body: "visto" }, keyed("k2")),
		).rejects.toMatchObject({ code: "NOTE_NOT_FOUND" });

		test.prepare.delegation("ana", "probe", "write", "no");
		await expect(
			client.probe.editNote({ id: 1, body: "visto" }, keyed("k3")),
		).rejects.toMatchObject(forbidden);
	});
});

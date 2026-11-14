// The platform's sensitive operations (ADR 0023), through createTestPlatform with probe: changing permissions
// (only the admin, on a member or the device account), changing delegation (one's own, and the device account's
// by the admin), and revoking another session of one's own or a device of the device account. Each one needs a
// step-up proof of that exact operation, and leaves its entry in the action log.
import { createTestPlatform, type TestPlatform } from "@domus/test-utils";
import { describe, expect, it } from "vitest";

import probe from "../server";

const PASSWORD = "correct horse battery staple";
const stepUp = expect.objectContaining({ code: "STEP_UP_REQUIRED" });
const forbidden = expect.objectContaining({ code: "FORBIDDEN" });
const notFound = expect.objectContaining({ code: "NOT_FOUND" });
const badRequest = expect.objectContaining({ code: "BAD_REQUEST" });

/** A platform with probe; Paco, the admin, and Ana and Luis, members, all with a password. */
async function household() {
	const test = createTestPlatform({ modules: [probe] });
	test.prepare.account({ id: "paco", role: "admin" });
	for (const id of ["ana", "luis"]) test.prepare.account({ id, role: "member" });
	for (const id of ["paco", "ana", "luis"]) await test.prepare.password(id, PASSWORD);
	return test;
}

/** A proof of `name` with `input`, asked for by `context` with the right password. */
async function proofOf(
	test: TestPlatform,
	context: ReturnType<TestPlatform["context"]>,
	name: string,
	input: unknown,
): Promise<string> {
	return (await test.requestProof(context, PASSWORD, { action: `platform.${name}`, input }))
		.proof;
}

describe("changing permissions", () => {
	it("lets the admin change a member's and the device account's, with a proof, and logs it", async () => {
		await using test = await household();
		const paco = test.context("paco");
		const toNone = { account: "ana", area: "probe", level: "none" } as const;
		const deviceWrites = {
			account: test.deviceAccount,
			area: "probe",
			level: "write",
		} as const;

		expect(() => test.setPermission(paco, toNone, { idempotencyKey: "p1" })).toThrow(stepUp);
		const proof = await proofOf(test, paco, "setPermission", toNone);
		expect(test.setPermission(paco, toNone, { idempotencyKey: "p1", proof })).toEqual({
			result: toNone,
			entry: 1,
		});
		expect(() => test.invoke(test.context("ana"), "probe.listNotes")).toThrow(forbidden);

		const kitchen = test.context(test.deviceAccount, { identity: "device" });
		expect(() =>
			test.invoke(kitchen, "probe.addNote", { body: "x" }, { idempotencyKey: "k1" }),
		).toThrow(forbidden);
		test.setPermission(paco, deviceWrites, {
			idempotencyKey: "p2",
			proof: await proofOf(test, paco, "setPermission", deviceWrites),
		});
		expect(
			test.invoke(kitchen, "probe.addNote", { body: "x" }, { idempotencyKey: "k1" }),
		).toMatchObject({ result: { body: "x" } });

		expect(test.log()).toMatchObject([
			{ action: "platform.setPermission", actor: { account: "paco" }, input: toNone },
			{ action: "platform.setPermission", input: deviceWrites },
			{ action: "probe.addNote" },
		]);
	});

	it("lets nobody change their own, and no member another's, even with a proof", async () => {
		await using test = await household();
		const cases = [
			["paco", { account: "paco", area: "probe", level: "none" }],
			["ana", { account: "ana", area: "probe", level: "manage" }],
			["ana", { account: "luis", area: "probe", level: "none" }],
		] as const;

		for (const [who, change] of cases) {
			const context = test.context(who);
			const proof = await proofOf(test, context, "setPermission", change);
			expect(() =>
				test.setPermission(context, change, { idempotencyKey: "p1", proof }),
			).toThrow(forbidden);
		}
		expect(test.log()).toEqual([]);
	});

	it("refuses the platform's area: nobody's own settings can be frozen", async () => {
		await using test = await household();
		const paco = test.context("paco");
		const ana = test.context("ana", test.prepare.session("ana"));
		const freeze = { account: "ana", area: "platform", level: "read" } as const;

		await expect(
			test.requestProof(paco, PASSWORD, { action: "platform.setPermission", input: freeze }),
		).rejects.toThrow(badRequest);
		expect(() => test.setPermission(paco, freeze, { idempotencyKey: "p1" })).toThrow(
			badRequest,
		);
		expect(test.log()).toEqual([]);

		// Ana still changes her own delegation, which writes in the platform's area.
		const mine = { account: "ana", area: "probe", level: "write", value: "confirm" } as const;
		expect(
			test.setDelegation(ana, mine, {
				idempotencyKey: "d1",
				proof: await proofOf(test, ana, "setDelegation", mine),
			}),
		).toMatchObject({ result: mine });
	});

	it("is denied via Kira, even with a proof and the delegation", async () => {
		await using test = await household();
		test.prepare.delegation("paco", "platform", "write", "yes");
		const kira = test.context("paco", { via: "kira" });
		const change = { account: "ana", area: "probe", level: "none" } as const;
		const proof = await proofOf(test, kira, "setPermission", change);

		expect(() => test.setPermission(kira, change, { idempotencyKey: "p1", proof })).toThrow(
			forbidden,
		);
	});
});

describe("changing delegation", () => {
	it("lets each person change their own and the admin the device account's, with a proof", async () => {
		await using test = await household();
		const ana = test.context("ana");
		const paco = test.context("paco");
		const mine = { account: "ana", area: "probe", level: "write", value: "confirm" } as const;
		const device = {
			account: test.deviceAccount,
			area: "probe",
			level: "read",
			value: "no",
		} as const;

		expect(() => test.setDelegation(ana, mine, { idempotencyKey: "d1" })).toThrow(stepUp);
		test.setDelegation(ana, mine, {
			idempotencyKey: "d1",
			proof: await proofOf(test, ana, "setDelegation", mine),
		});
		test.setDelegation(paco, device, {
			idempotencyKey: "d2",
			proof: await proofOf(test, paco, "setDelegation", device),
		});

		expect(test.delegation(ana, "ana").probe).toEqual({
			read: "yes",
			write: "confirm",
			manage: "no",
		});
		expect(test.delegation(paco, test.deviceAccount).probe?.read).toBe("no");
		expect(test.log()).toMatchObject([
			{ action: "platform.setDelegation", actor: { account: "ana" }, input: mine },
			{ action: "platform.setDelegation", actor: { account: "paco" }, input: device },
		]);
	});

	it("lets no member change another's, nor the admin a member's", async () => {
		await using test = await household();
		const cases = [
			["ana", "luis"],
			["paco", "ana"],
		] as const;

		for (const [who, account] of cases) {
			const context = test.context(who);
			const change = { account, area: "probe", level: "read", value: "no" } as const;
			const proof = await proofOf(test, context, "setDelegation", change);
			expect(() =>
				test.setDelegation(context, change, { idempotencyKey: "d1", proof }),
			).toThrow(forbidden);
		}
	});

	it("is denied via Kira, even with a proof and the delegation", async () => {
		await using test = await household();
		test.prepare.delegation("ana", "platform", "write", "yes");
		const kira = test.context("ana", { via: "kira" });
		const change = { account: "ana", area: "probe", level: "write", value: "yes" } as const;
		const proof = await proofOf(test, kira, "setDelegation", change);

		expect(() => test.setDelegation(kira, change, { idempotencyKey: "d1", proof })).toThrow(
			forbidden,
		);
	});
});

describe("revoking", () => {
	it("revokes another session of one's own with a proof, which ends what was born in it", async () => {
		await using test = await household();
		const phone = test.prepare.session("ana");
		const laptop = test.prepare.session("ana");
		const fromPhone = test.context("ana", phone);
		const fromLaptop = test.context("ana", laptop);
		const bornOnLaptop = await proofOf(test, fromLaptop, "revokeSession", {
			session: phone.session,
		});

		expect(() =>
			test.revokeSession(fromPhone, laptop.session, { idempotencyKey: "r1" }),
		).toThrow(stepUp);
		test.revokeSession(fromPhone, laptop.session, {
			idempotencyKey: "r1",
			proof: await proofOf(test, fromPhone, "revokeSession", { session: laptop.session }),
		});

		expect(test.hasSession(laptop.session)).toBe(false);
		expect(test.hasSession(phone.session)).toBe(true);
		// The laptop's proof ended with its session.
		expect(() =>
			test.revokeSession(fromLaptop, phone.session, {
				idempotencyKey: "r2",
				proof: bornOnLaptop,
			}),
		).toThrow(stepUp);
	});

	it("does not revoke the current session nor another account's", async () => {
		await using test = await household();
		const mine = test.prepare.session("ana");
		const luis = test.prepare.session("luis");
		const ana = test.context("ana", mine);

		const current = await proofOf(test, ana, "revokeSession", { session: mine.session });
		const others = await proofOf(test, ana, "revokeSession", { session: luis.session });

		expect(() =>
			test.revokeSession(ana, mine.session, { idempotencyKey: "r1", proof: current }),
		).toThrow(expect.objectContaining({ code: "BAD_REQUEST" }));
		expect(() =>
			test.revokeSession(ana, luis.session, { idempotencyKey: "r2", proof: others }),
		).toThrow(notFound);
		expect(test.hasSession(mine.session)).toBe(true);
		expect(test.hasSession(luis.session)).toBe(true);
	});

	it("answers another account's session as one that does not exist, with or without a proof", async () => {
		await using test = await household();
		const luis = test.prepare.session("luis");
		const ana = test.context("ana", test.prepare.session("ana"));
		const unknown = "no-such-session";

		for (const session of [luis.session, unknown]) {
			expect(() => test.revokeSession(ana, session, { idempotencyKey: "r1" })).toThrow(
				notFound,
			);
			const proof = await proofOf(test, ana, "revokeSession", { session });
			expect(() => test.revokeSession(ana, session, { idempotencyKey: "r1", proof })).toThrow(
				notFound,
			);
		}
		expect(test.hasSession(luis.session)).toBe(true);
		expect(test.log()).toEqual([]);
	});

	it("lets the admin revoke a session of the device account, and no member", async () => {
		await using test = await household();
		const kitchen = test.prepare.session(test.deviceAccount);
		const ana = test.context("ana");
		const paco = test.context("paco");
		const input = { session: kitchen.session };
		const anaProof = await proofOf(test, ana, "revokeSession", input);

		expect(() =>
			test.revokeSession(ana, kitchen.session, { idempotencyKey: "r1", proof: anaProof }),
		).toThrow(notFound);
		test.revokeSession(paco, kitchen.session, {
			idempotencyKey: "r1",
			proof: await proofOf(test, paco, "revokeSession", input),
		});
		expect(test.hasSession(kitchen.session)).toBe(false);
	});

	it("revokes a device of the device account with a proof: all its sessions, and nothing on other devices", async () => {
		await using test = await household();
		const kitchen = test.prepare.session(test.deviceAccount);
		const anaInKitchen = test.prepare.session("ana", kitchen.device);
		const hall = test.prepare.session(test.deviceAccount);
		const anaOnPhone = test.prepare.session("ana");
		const paco = test.context("paco");
		const input = { session: kitchen.session };
		// A proof asked for on the kitchen's device ends with it.
		const askedInKitchen = await proofOf(
			test,
			test.context("ana", anaInKitchen),
			"revokeSession",
			{
				session: anaOnPhone.session,
			},
		);

		expect(() => test.revokeDevice(paco, kitchen.session, { idempotencyKey: "v1" })).toThrow(
			stepUp,
		);
		expect(
			test.revokeDevice(paco, kitchen.session, {
				idempotencyKey: "v1",
				proof: await proofOf(test, paco, "revokeDevice", input),
			}),
		).toMatchObject({ result: { endedSessions: 2 } });

		expect(test.hasSession(kitchen.session)).toBe(false);
		expect(test.hasSession(anaInKitchen.session)).toBe(false);
		expect(test.hasSession(hall.session)).toBe(true);
		expect(test.hasSession(anaOnPhone.session)).toBe(true);
		expect(() =>
			test.revokeSession(test.context("ana", anaInKitchen), anaOnPhone.session, {
				idempotencyKey: "r1",
				proof: askedInKitchen,
			}),
		).toThrow(stepUp);
	});

	it("does not revoke a member's device as one of the device account", async () => {
		await using test = await household();
		const phone = test.prepare.session("ana");
		const ana = test.context("ana");
		const proof = await proofOf(test, ana, "revokeDevice", { session: phone.session });

		expect(() =>
			test.revokeDevice(ana, phone.session, { idempotencyKey: "v1", proof }),
		).toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
		expect(test.hasSession(phone.session)).toBe(true);
	});

	it("answers a device it cannot revoke as one that does not exist, before asking for a proof", async () => {
		await using test = await household();
		const kitchen = test.prepare.session(test.deviceAccount);
		const luis = test.prepare.session("luis");
		const paco = test.context("paco");
		const ana = test.context("ana");

		for (const [context, session] of [
			[paco, luis.session],
			[paco, "no-such-session"],
			[ana, kitchen.session],
		] as const)
			expect(() => test.revokeDevice(context, session, { idempotencyKey: "v1" })).toThrow(
				notFound,
			);
		expect(test.hasSession(kitchen.session)).toBe(true);
		expect(test.hasSession(luis.session)).toBe(true);
		expect(test.log()).toEqual([]);
	});

	it("is denied with an identity proven by voice or by the device", async () => {
		await using test = await household();
		const kitchen = test.prepare.session(test.deviceAccount);
		const paco = test.context("paco");
		const proof = await proofOf(test, paco, "revokeSession", { session: kitchen.session });

		for (const identity of ["voice", "device"] as const)
			expect(() =>
				test.revokeSession(test.context("paco", { identity }), kitchen.session, {
					idempotencyKey: "r1",
					proof,
				}),
			).toThrow(forbidden);
	});
});

describe("proofs and the session's expiry", () => {
	it("keeps a proof good until its session expires, and ends it then though the session's row is still there", async () => {
		await using test = await household();
		const laptop = test.prepare.session("paco");
		const paco = test.context("paco", laptop);
		const expiresAt = test.sessionExpiresAt(laptop.session) ?? 0;
		const toNone = { account: "ana", area: "probe", level: "none" } as const;
		const toRead = { account: "luis", area: "probe", level: "read" } as const;
		test.clock.set(expiresAt - 60_000);
		const before = await proofOf(test, paco, "setPermission", toNone);
		const after = await proofOf(test, paco, "setPermission", toRead);

		test.clock.set(expiresAt - 1);
		expect(
			test.setPermission(paco, toNone, { idempotencyKey: "p1", proof: before }),
		).toMatchObject({
			entry: 1,
		});

		test.clock.set(expiresAt);
		expect(test.hasSession(laptop.session)).toBe(true);
		expect(() =>
			test.setPermission(paco, toRead, { idempotencyKey: "p2", proof: after }),
		).toThrow(stepUp);
		await expect(
			test.requestProof(paco, PASSWORD, { action: "platform.setPermission", input: toRead }),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });
	});
});

describe("proofs and the password", () => {
	it("ends a used proof too, so a repeat with it asks for a new one after the password changes", async () => {
		await using test = await household();
		const paco = test.context("paco");
		const toNone = { account: "ana", area: "probe", level: "none" } as const;
		const proof = await proofOf(test, paco, "setPermission", toNone);
		test.setPermission(paco, toNone, { idempotencyKey: "p1", proof });
		expect(test.setPermission(paco, toNone, { idempotencyKey: "p1", proof })).toMatchObject({
			entry: 1,
		});

		const browser = test.browser();
		expect((await browser.signIn("paco@domus.test", PASSWORD)).status).toBe(200);
		const response = await browser.fetch(
			new Request("http://domus.test/api/rpc/password/change", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					json: { currentPassword: PASSWORD, newPassword: "a brand new passphrase" },
				}),
			}),
		);
		expect(response.status).toBe(200);

		expect(() => test.setPermission(paco, toNone, { idempotencyKey: "p1", proof })).toThrow(
			stepUp,
		);
	});

	it("ends every proof of the account when its password changes, also one of a session it keeps", async () => {
		await using test = await household();
		const kitchen = test.prepare.session(test.deviceAccount);
		const paco = test.context("paco");
		const proof = await proofOf(test, paco, "revokeSession", { session: kitchen.session });

		const browser = test.browser();
		expect((await browser.signIn("paco@domus.test", PASSWORD)).status).toBe(200);
		const response = await browser.fetch(
			new Request("http://domus.test/api/rpc/password/change", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					json: { currentPassword: PASSWORD, newPassword: "a brand new passphrase" },
				}),
			}),
		);
		expect(response.status).toBe(200);

		expect(() =>
			test.revokeSession(paco, kitchen.session, {
				idempotencyKey: "r1",
				proof,
			}),
		).toThrow(stepUp);
	});
});

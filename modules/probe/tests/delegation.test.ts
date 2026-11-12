import { createTestPlatform } from "@domus/test-utils";
import { describe, expect, it } from "vitest";

import probe from "../server";

const forbidden = expect.objectContaining({ code: "FORBIDDEN" });

/** What a new member delegates in an area: read and write copied from its `write`, manage denied. */
const MEMBER_START = { read: "yes", write: "yes", manage: "no" };

describe("probe via Kira, with the delegation table", () => {
	it("denies a level the account delegates as no, without running anything", async () => {
		await using test = createTestPlatform({ modules: [probe] });
		const ana = test.member("ana", { via: "kira" });
		test.prepare.delegation("ana", "probe", "write", "no");

		expect(test.invoke(ana, "probe.listNotes")).toEqual([]);
		expect(() =>
			test.invoke(ana, "probe.addNote", { body: "regar" }, { idempotencyKey: "k1" }),
		).toThrow(forbidden);
		expect(test.log()).toEqual([]);
	});

	it("allows a level the account delegates as yes, and still applies its own no without via", async () => {
		await using test = createTestPlatform({ modules: [probe] });
		test.member("ana");
		test.prepare.delegation("ana", "probe", "read", "no");
		test.prepare.delegation("ana", "probe", "write", "yes");
		const kira = test.context("ana", { via: "kira" });

		expect(() => test.invoke(kira, "probe.listNotes")).toThrow(forbidden);
		expect(
			test.invoke(kira, "probe.addNote", { body: "regar" }, { idempotencyKey: "k1" }),
		).toEqual({ result: { id: 1, body: "regar" }, entry: 1 });
		expect(test.invoke(test.context("ana"), "probe.listNotes")).toEqual([
			{ id: 1, body: "regar" },
		]);
	});

	it("denies confirm for now: asking the person comes with pending confirmations", async () => {
		await using test = createTestPlatform({ modules: [probe] });
		const ana = test.member("ana", { via: "kira" });
		test.prepare.delegation("ana", "probe", "write", "confirm");

		expect(() =>
			test.invoke(ana, "probe.addNote", { body: "regar" }, { idempotencyKey: "k1" }),
		).toThrow(forbidden);
	});

	it("never goes past the account's permission, whatever it delegates", async () => {
		await using test = createTestPlatform({ modules: [probe] });
		const ana = test.member("ana", { via: "kira" });
		test.prepare.grant("ana", "probe", "read");
		test.prepare.delegation("ana", "probe", "write", "yes");

		expect(test.invoke(ana, "probe.listNotes")).toEqual([]);
		expect(() =>
			test.invoke(ana, "probe.addNote", { body: "regar" }, { idempotencyKey: "k1" }),
		).toThrow(forbidden);
	});
});

describe("the delegation table of a new account", () => {
	it("copies read and write from the account's permission, with manage denied and nothing to confirm", async () => {
		await using test = createTestPlatform({ modules: [probe] });
		const ana = test.member("ana");
		const paco = test.context(test.prepare.account({ id: "paco", role: "admin" }));

		expect(test.delegation(ana, "ana")).toEqual({
			platform: MEMBER_START,
			probe: MEMBER_START,
		});
		expect(test.delegation(paco, "paco")).toEqual({
			platform: MEMBER_START,
			probe: MEMBER_START,
		});
		expect(test.delegation(paco, test.deviceAccount)).toEqual({
			platform: { read: "yes", write: "no", manage: "no" },
			probe: { read: "yes", write: "no", manage: "no" },
		});
	});

	it("does not follow a permission raised later: Kira does not gain it by itself", async () => {
		await using test = createTestPlatform({ modules: [probe] });
		const paco = test.context(test.prepare.account({ id: "paco", role: "admin" }));
		const before = test.delegation(paco, test.deviceAccount);
		test.prepare.grant(test.deviceAccount, "probe", "write");

		expect(test.delegation(paco, test.deviceAccount)).toEqual(before);
		const kitchen = test.context(test.deviceAccount, { identity: "device" });
		const kira = test.context(test.deviceAccount, { identity: "device", via: "kira" });
		expect(
			test.invoke(kitchen, "probe.addNote", { body: "regar" }, { idempotencyKey: "k1" }),
		).toEqual({ result: { id: 1, body: "regar" }, entry: 1 });
		expect(() =>
			test.invoke(kira, "probe.addNote", { body: "fregar" }, { idempotencyKey: "k2" }),
		).toThrow(forbidden);
	});
});

describe("reading the delegation", () => {
	it("lets each person read their own, with what the preparation set", async () => {
		await using test = createTestPlatform({ modules: [probe] });
		const ana = test.member("ana");
		test.prepare.delegation("ana", "probe", "write", "confirm");

		expect(test.delegation(ana, "ana").probe).toEqual({
			read: "yes",
			write: "confirm",
			manage: "no",
		});
	});

	it("lets the admin read the device account's, and nobody else's", async () => {
		await using test = createTestPlatform({ modules: [probe] });
		const paco = test.context(test.prepare.account({ id: "paco", role: "admin" }));
		const ana = test.member("ana");

		expect(test.delegation(paco, test.deviceAccount).probe).toEqual({
			read: "yes",
			write: "no",
			manage: "no",
		});
		expect(() => test.delegation(paco, "ana")).toThrow(forbidden);
		expect(() => test.delegation(ana, "paco")).toThrow(forbidden);
		expect(() => test.delegation(ana, test.deviceAccount)).toThrow(forbidden);
	});

	it("via Kira, needs the platform area's read delegated", async () => {
		await using test = createTestPlatform({ modules: [probe] });
		const kira = test.member("ana", { via: "kira" });

		expect(test.delegation(kira, "ana").probe).toEqual(MEMBER_START);

		test.prepare.delegation("ana", "platform", "read", "no");

		expect(() => test.delegation(kira, "ana")).toThrow(forbidden);
	});
});

// Reading the delegation over HTTP (ADR 0023): `delegation/read` answers one's own table, or the device
// account's to the admin, and needs a session; it is a read of the platform's area on the path of the actions.
import { clientFor } from "@domus/api-client";
import {
	createTestPlatform,
	platformContract,
	TEST_ORIGIN,
	type TestBrowser,
} from "@domus/test-utils";
import { describe, expect, it } from "vitest";

import probe from "../server";

const PASSWORD = "correct horse battery staple";

/** A platform with probe; Paco, the admin, and Ana and Luis, members, all with a password. */
async function household() {
	const test = createTestPlatform({ modules: [probe] });
	test.prepare.account({ id: "paco", role: "admin" });
	for (const id of ["ana", "luis"]) test.prepare.account({ id, role: "member" });
	for (const id of ["paco", "ana", "luis"]) await test.prepare.password(id, PASSWORD);
	return test;
}

function clientOf(browser: TestBrowser) {
	return clientFor(platformContract, { baseUrl: TEST_ORIGIN, fetch: browser.fetch });
}

async function signedIn(test: { browser(): TestBrowser }, who: string) {
	const browser = test.browser();
	expect((await browser.signIn(`${who}@domus.test`, PASSWORD)).status).toBe(200);
	return clientOf(browser);
}

describe("reading the delegation over HTTP", () => {
	it("answers one's own table, with what was set", async () => {
		await using test = await household();
		test.prepare.delegation("ana", "probe", "write", "confirm");
		const ana = await signedIn(test, "ana");

		const table = await ana.delegation.read({ account: "ana" });

		expect(table.probe).toEqual({ read: "yes", write: "confirm", manage: "no" });
		expect(table).toEqual(test.delegation(test.context("ana"), "ana"));
	});

	it("lets the admin read the device account's, and nobody another person's", async () => {
		await using test = await household();
		const paco = await signedIn(test, "paco");
		const ana = await signedIn(test, "ana");

		expect((await paco.delegation.read({ account: test.deviceAccount })).probe).toEqual({
			read: "yes",
			write: "no",
			manage: "no",
		});
		const forbidden = { code: "FORBIDDEN" };
		await expect(paco.delegation.read({ account: "ana" })).rejects.toMatchObject(forbidden);
		await expect(ana.delegation.read({ account: "luis" })).rejects.toMatchObject(forbidden);
		await expect(ana.delegation.read({ account: test.deviceAccount })).rejects.toMatchObject(
			forbidden,
		);
	});

	it("needs a session", async () => {
		await using test = await household();

		await expect(
			clientOf(test.browser()).delegation.read({ account: "ana" }),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });
	});
});

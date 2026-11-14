// The criterion of ADR 0020, as ADR 0030 places it in the integration: the client `assistant` builds, with its
// transport, runs an action of probe against the door in process with its key and a test mandate, and answers
// `UNAUTHORIZED` without the key. tooling composes an app with a module because neither may import the other.
import { probeContract } from "@domus/probe/contracts";
import probe from "@domus/probe/server";
import { createTestPlatform, TEST_ORIGIN } from "@domus/test-utils";
import { describe, expect, it } from "vitest";

import { apiClient } from "../../apps/assistant/src/api";

const PASSWORD = "correct horse battery staple";

/** The contract Kira calls here: probe's actions. */
const contract = { probe: probeContract };

/** A platform with probe and Ana, signed in, who lets Kira read and write probe; and a mandate from her session. */
async function anaWithMandate() {
	const test = createTestPlatform({ modules: [probe] });
	test.prepare.account({ id: "ana", role: "member" });
	await test.prepare.password("ana", PASSWORD);
	test.prepare.delegation("ana", "probe", "read", "yes");
	test.prepare.delegation("ana", "probe", "write", "yes");
	const browser = test.browser();
	expect((await browser.signIn("ana@domus.test", PASSWORD)).status).toBe(200);
	return { test, mandate: test.mandate(browser) };
}

describe("assistant's client against the door", () => {
	it("runs an action of probe with its key and a mandate", async () => {
		const { test, mandate } = await anaWithMandate();
		await using _ = test;
		const access = {
			baseUrl: TEST_ORIGIN,
			fetch: test.door.fetch,
			key: test.prepare.key("kira"),
		};
		const client = apiClient(contract, access, mandate);

		await client.probe.addNote({ body: "leche" }, { context: { idempotencyKey: "k1" } });
		expect(await client.probe.listNotes()).toEqual([{ id: 1, body: "leche", files: [] }]);
		expect(test.log()).toMatchObject([{ actor: { account: "ana", via: "kira" } }]);
	});

	it("answers unauthorized without the key, the mandate notwithstanding", async () => {
		const { test, mandate } = await anaWithMandate();
		await using _ = test;
		const client = apiClient(
			contract,
			{ baseUrl: TEST_ORIGIN, fetch: test.door.fetch, key: undefined },
			mandate,
		);

		await expect(client.probe.listNotes()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
		await expect(
			client.probe.addNote({ body: "leche" }, { context: { idempotencyKey: "k1" } }),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });
		expect(test.log()).toEqual([]);
	});
});

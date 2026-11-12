// Reading the action log and undoing over HTTP (ADR 0023): `log/read` answers the annotations of one's own
// entries and `log/undo` undoes one of them, with its idempotency key in a header; both need a session.
import { clientFor } from "@domus/api-client";
import {
	createTestPlatform,
	platformContract,
	TEST_ORIGIN,
	type TestBrowser,
} from "@domus/test-utils";
import { describe, expect, it } from "vitest";

import { probeContract } from "../contracts";
import probe from "../server";

const PASSWORD = "correct horse battery staple";

/** A platform with probe, and Ana and Luis with a password. */
async function household() {
	const test = createTestPlatform({ modules: [probe] });
	for (const id of ["ana", "luis"]) {
		test.prepare.account({ id, role: "member" });
		await test.prepare.password(id, PASSWORD);
	}
	return test;
}

function clientOf(browser: TestBrowser) {
	return clientFor(
		{ ...platformContract, probe: probeContract },
		{ baseUrl: TEST_ORIGIN, fetch: browser.fetch },
	);
}

async function signedIn(test: { browser(): TestBrowser }, who: string): Promise<TestBrowser> {
	const browser = test.browser();
	expect((await browser.signIn(`${who}@domus.test`, PASSWORD)).status).toBe(200);
	return browser;
}

describe("the action log over HTTP", () => {
	it("reads one's own annotations and undoes one's own entry, which another account does not find", async () => {
		await using test = await household();
		const ana = clientOf(await signedIn(test, "ana"));
		const luis = clientOf(await signedIn(test, "luis"));
		await ana.probe.addNote({ body: "comprar pan" }, { context: { idempotencyKey: "k1" } });

		expect(await ana.log.read()).toEqual([
			{
				entry: 1,
				action: "probe.addNote",
				actor: { account: "ana" },
				at: test.clock.now(),
				undoes: null,
				undoneBy: null,
				touched: [{ module: "probe", type: "note", id: "1" }],
			},
		]);
		expect(await luis.log.read()).toEqual([]);
		await expect(
			luis.log.undo({ entry: 1 }, { context: { idempotencyKey: "u1" } }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });

		expect(await ana.log.undo({ entry: 1 }, { context: { idempotencyKey: "u1" } })).toEqual({
			result: { id: 1, body: "comprar pan" },
			entry: 2,
		});
		expect(await ana.log.undo({ entry: 1 }, { context: { idempotencyKey: "u1" } })).toEqual({
			entry: 2,
			repeated: true,
		});
		expect(await ana.probe.listNotes()).toEqual([]);
	});

	it("needs a session, and an undo needs its key", async () => {
		await using test = await household();
		const anonymous = clientOf(test.browser());
		const ana = clientOf(await signedIn(test, "ana"));
		await ana.probe.addNote({ body: "comprar pan" }, { context: { idempotencyKey: "k1" } });

		await expect(anonymous.log.read()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
		await expect(
			anonymous.log.undo({ entry: 1 }, { context: { idempotencyKey: "u1" } }),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });
		await expect(ana.log.undo({ entry: 1 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});
});

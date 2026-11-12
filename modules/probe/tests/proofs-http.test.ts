// Step-up proofs over HTTP (ADR 0023): the door with probe composed in the test, Better Auth through its routes
// and api-client, which sends a call's proof in its own header. Asking for one and using it, revoking another
// session with one, and changing the password, which ends them all.
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
const CONFIGURE = { action: "probe.configure", input: { visibility: "public" } } as const;

/** A platform with probe, and Paco, the admin, with a password and a note. */
async function household() {
	const test = createTestPlatform({ modules: [probe] });
	test.prepare.account({ id: "paco", role: "admin" });
	await test.prepare.password("paco", PASSWORD);
	test.invoke(test.context("paco"), "probe.addNote", { body: "pan" }, { idempotencyKey: "n1" });
	return test;
}

function clientOf(browser: TestBrowser) {
	return clientFor(
		{ ...platformContract, probe: probeContract },
		{ baseUrl: TEST_ORIGIN, fetch: browser.fetch },
	);
}

async function signedIn(test: { browser(): TestBrowser }): Promise<TestBrowser> {
	const browser = test.browser();
	expect((await browser.signIn("paco@domus.test", PASSWORD)).status).toBe(200);
	return browser;
}

describe("step-up proofs over HTTP", () => {
	it("asks for one with the password and runs the operation with it, once", async () => {
		await using test = await household();
		const client = clientOf(await signedIn(test));

		await expect(
			client.probe.configure({ visibility: "public" }, { context: { idempotencyKey: "c1" } }),
		).rejects.toMatchObject({ code: "STEP_UP_REQUIRED", status: 403 });

		const { proof } = await client.proofs.request({ password: PASSWORD, operation: CONFIGURE });
		expect(
			await client.probe.configure(
				{ visibility: "public" },
				{ context: { idempotencyKey: "c1", proof } },
			),
		).toEqual({ result: { notes: 1 }, entry: 2 });
		await expect(
			client.probe.configure(
				{ visibility: "public" },
				{ context: { idempotencyKey: "c2", proof } },
			),
		).rejects.toMatchObject({ code: "STEP_UP_REQUIRED" });
	});

	it("does not take a proof asked for from another session", async () => {
		await using test = await household();
		const phone = clientOf(await signedIn(test));
		const laptop = clientOf(await signedIn(test));

		const { proof } = await laptop.proofs.request({ password: PASSWORD, operation: CONFIGURE });

		await expect(
			phone.probe.configure(
				{ visibility: "public" },
				{ context: { idempotencyKey: "c1", proof } },
			),
		).rejects.toMatchObject({ code: "STEP_UP_REQUIRED" });
	});

	it("answers a wrong password without repeating it, and without a session not at all", async () => {
		await using test = await household();
		const browser = await signedIn(test);

		const response = await browser.fetch(
			new Request(`${TEST_ORIGIN}/api/rpc/proofs/request`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					json: { password: "not my password", operation: CONFIGURE },
				}),
			}),
		);

		expect(response.status).toBe(403);
		const body = await response.text();
		expect(body).toContain("wrong-password");
		expect(body).not.toContain("not my password");
		await expect(
			clientOf(test.browser()).proofs.request({ password: PASSWORD, operation: CONFIGURE }),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });
	});

	it("revokes another session with a proof: it fails on its next request", async () => {
		await using test = await household();
		const phone = clientOf(await signedIn(test));
		const laptop = clientOf(await signedIn(test));
		const other = (await phone.sessions.list()).find((session) => !session.current);
		const input = { session: other?.id ?? "" };

		await expect(
			phone.sessions.revoke(input, { context: { idempotencyKey: "r1" } }),
		).rejects.toMatchObject({ code: "STEP_UP_REQUIRED" });
		const { proof } = await phone.proofs.request({
			password: PASSWORD,
			operation: { action: "platform.revokeSession", input },
		});
		expect(
			await phone.sessions.revoke(input, { context: { idempotencyKey: "r1", proof } }),
		).toEqual({ result: input, entry: 2 });

		await expect(laptop.sessions.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
		expect(await phone.sessions.list()).toHaveLength(1);
	});

	it("ends every proof when the password changes", async () => {
		await using test = await household();
		const client = clientOf(await signedIn(test));
		const { proof } = await client.proofs.request({ password: PASSWORD, operation: CONFIGURE });

		await client.password.change({ currentPassword: PASSWORD, newPassword: "a brand new one" });

		await expect(
			client.probe.configure(
				{ visibility: "public" },
				{ context: { idempotencyKey: "c1", proof } },
			),
		).rejects.toMatchObject({ code: "STEP_UP_REQUIRED" });
	});
});

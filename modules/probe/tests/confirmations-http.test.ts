// Pending confirmations over HTTP (ADR 0023): probe's `deleteComment`, which always asks, answers
// `CONFIRMATION_REQUIRED` and is confirmed by the app; revoking its session or changing the password ends it.
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

/** A platform with probe, Ana and Luis with a password, and a note of Ana's with a comment. */
async function household() {
	const test = createTestPlatform({ modules: [probe] });
	for (const id of ["ana", "luis"]) {
		test.prepare.account({ id, role: "member" });
		await test.prepare.password(id, PASSWORD);
	}
	const ana = test.context("ana");
	test.invoke(ana, "probe.addNote", { body: "comprar pan" }, { idempotencyKey: "k1" });
	test.invoke(ana, "probe.addComment", { noteId: 1, body: "integral" }, { idempotencyKey: "k2" });
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

/** Asks to delete the comment from `browser`, and returns the id of the pending confirmation it answers. */
async function askToDelete(browser: TestBrowser): Promise<string> {
	const error: unknown = await clientOf(browser)
		.probe.deleteComment({ id: 1 }, { context: { idempotencyKey: "d1" } })
		.then(
			() => undefined,
			(thrown: unknown) => thrown,
		);
	expect(error).toMatchObject({ code: "CONFIRMATION_REQUIRED", status: 428 });
	return (error as { data: { confirmation: string } }).data.confirmation;
}

const expired = { code: "CONFLICT", data: { reason: "confirmation-expired" } };

describe("pending confirmations over HTTP", () => {
	it("answers CONFIRMATION_REQUIRED to a write, which the app confirms from another session", async () => {
		await using test = await household();
		const phone = await signedIn(test, "ana");
		const laptop = await signedIn(test, "ana");
		const pending = await askToDelete(phone);
		expect(await askToDelete(phone)).toBe(pending);

		await expect(
			clientOf(await signedIn(test, "luis")).confirmations.confirm({ id: pending }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		await expect(
			clientOf(test.browser()).confirmations.confirm({ id: pending }),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });

		expect(await clientOf(laptop).confirmations.confirm({ id: pending })).toEqual({
			result: { id: 1, noteId: 1, body: "integral" },
			entry: 3,
		});
		await expect(clientOf(phone).confirmations.confirm({ id: pending })).rejects.toMatchObject({
			code: "CONFLICT",
			data: { reason: "confirmation-consumed" },
		});
	});

	it("rejects one from the app", async () => {
		await using test = await household();
		const phone = await signedIn(test, "ana");
		const pending = await askToDelete(phone);

		await clientOf(phone).confirmations.reject({ id: pending });

		await expect(clientOf(phone).confirmations.confirm({ id: pending })).rejects.toMatchObject({
			code: "CONFLICT",
			data: { reason: "confirmation-consumed" },
		});
		expect(test.log()).toHaveLength(2);
	});

	it("ends one when the session it was born in is revoked", async () => {
		await using test = await household();
		const phone = await signedIn(test, "ana");
		const laptop = await signedIn(test, "ana");
		const pending = await askToDelete(phone);

		await phone.signOut();

		await expect(clientOf(laptop).confirmations.confirm({ id: pending })).rejects.toMatchObject(
			expired,
		);
		expect(test.log()).toHaveLength(2);
	});

	it("ends every one of the account when its password changes, also those of the session that changes it", async () => {
		await using test = await household();
		const phone = await signedIn(test, "ana");
		const pending = await askToDelete(phone);

		await clientOf(phone).password.change({
			currentPassword: PASSWORD,
			newPassword: "a brand new passphrase",
		});

		await expect(clientOf(phone).confirmations.confirm({ id: pending })).rejects.toMatchObject(
			expired,
		);
		expect(test.log()).toHaveLength(2);
	});
});

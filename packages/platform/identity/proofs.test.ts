// Asking for a step-up proof while the password changes (ADR 0023): changing it invalidates proofs, even one asked
// with the old password whose check was still running. Checking the password waits on a gate here, so the change
// commits deterministically while that check is in flight.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { connectionOf, createPlatform, type Platform } from "../platform";
import {
	invokeAction,
	prepareAccount,
	preparePassword,
	prepareSession,
	requestProofOf,
	syntheticContext,
} from "../testing";
import { replacePassword } from "./passwords";

const gate = vi.hoisted(() => ({ waiting: undefined as Promise<void> | undefined }));

vi.mock("better-auth/crypto", async (importOriginal) => {
	const original = await importOriginal<typeof import("better-auth/crypto")>();
	return {
		...original,
		verifyPassword: async (data: Parameters<typeof original.verifyPassword>[0]) => {
			await gate.waiting;
			return original.verifyPassword(data);
		},
	};
});

const OLD = "the-old-passphrase";
const NEW = "the-new-passphrase";

describe("requestProof", () => {
	let platform: Platform;
	beforeEach(() => {
		platform = createPlatform({ databaseFile: ":memory:", modules: [] });
	});
	afterEach(() => {
		gate.waiting = undefined;
		platform.close();
	});

	it("issues no proof when the password changed while the old one was being checked", async () => {
		prepareAccount(platform, {
			id: "ana",
			name: "Ana",
			email: "ana@domus.test",
			role: "admin",
		});
		await preparePassword(platform, "ana", OLD);
		const { session, device } = prepareSession(platform, "ana");
		const context = syntheticContext({
			account: "ana",
			device,
			session,
			deviceAccount: "ana",
			channel: "app",
			identity: "password",
		});
		const change = { account: "ana", area: "platform", level: "read", value: "confirm" };
		let release = () => {};
		gate.waiting = new Promise((resolve) => {
			release = resolve;
		});

		const asking = requestProofOf(platform, context, {
			password: OLD,
			operation: { action: "platform.setDelegation", input: change },
		});
		// The change keeps this session, so only the credential tells the old password from the new one.
		await replacePassword(connectionOf(platform), "ana", NEW, Date.now, { keep: session });
		release();

		await expect(asking).rejects.toMatchObject({
			code: "FORBIDDEN",
			data: { reason: "wrong-password" },
		});
		expect(() =>
			invokeAction(platform, {
				context,
				action: "platform.setDelegation",
				input: change,
				idempotencyKey: "d1",
			}),
		).toThrow(expect.objectContaining({ code: "STEP_UP_REQUIRED" }));
	});
});

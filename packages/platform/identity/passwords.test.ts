// Changing a password while its session runs out (ADR 0023): the new password is hashed before the transaction,
// and the session to keep must still live when it commits. Hashing waits on a gate here, so the platform clock
// moves past the session's expiry deterministically while the hash is in flight.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { connectionOf, type Platform } from "../platform";
import {
	createPlatformWithClock,
	prepareAccount,
	preparePassword,
	prepareSession,
} from "../testing";
import { passwordHashOf, replacePassword, SessionGoneError } from "./passwords";

const gate = vi.hoisted(() => ({ waiting: undefined as Promise<void> | undefined }));

vi.mock("better-auth/crypto", async (importOriginal) => {
	const original = await importOriginal<typeof import("better-auth/crypto")>();
	return {
		...original,
		hashPassword: async (password: string) => {
			await gate.waiting;
			return original.hashPassword(password);
		},
	};
});

const OLD = "the-old-passphrase";
const NEW = "the-new-passphrase";
const WEEK = 7 * 24 * 60 * 60 * 1000;

describe("replacePassword", () => {
	let now = Date.UTC(2026, 0, 1);
	let platform: Platform;
	beforeEach(() => {
		now = Date.UTC(2026, 0, 1);
		platform = createPlatformWithClock({ databaseFile: ":memory:", modules: [] }, () => now);
	});
	afterEach(() => {
		gate.waiting = undefined;
		platform.close();
	});

	it("changes nothing when the session to keep expires while the new password is hashed", async () => {
		prepareAccount(platform, {
			id: "ana",
			name: "Ana",
			email: "ana@domus.test",
			role: "admin",
		});
		await preparePassword(platform, "ana", OLD);
		const { session } = prepareSession(platform, "ana");
		const before = passwordHashOf(connectionOf(platform), "ana");
		let release = () => {};
		gate.waiting = new Promise((resolve) => {
			release = resolve;
		});

		const changing = replacePassword(connectionOf(platform), "ana", NEW, () => now, {
			keep: session,
		});
		now += WEEK;
		release();

		await expect(changing).rejects.toBeInstanceOf(SessionGoneError);
		expect(passwordHashOf(connectionOf(platform), "ana")).toBe(before);
	});
});

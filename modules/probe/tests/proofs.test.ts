// Step-up proofs (ADR 0023): probe's `configure`, of level manage, needs a proof of that exact operation, asked
// for with the password through the platform's real operation; and the platform's own sensitive operations:
// changing permissions and delegation, and revoking sessions and devices.
import { createTestPlatform, pendingFrom } from "@domus/test-utils";
import { describe, expect, it } from "vitest";

import probe from "../server";

const PASSWORD = "correct horse battery staple";
const stepUp = expect.objectContaining({ code: "STEP_UP_REQUIRED" });
const forbidden = expect.objectContaining({ code: "FORBIDDEN" });
const PUBLIC = { visibility: "public" } as const;
const CONFIGURE = { action: "probe.configure", input: PUBLIC } as const;

/** A platform with probe; Paco, the admin, with a password and a note; and Ana, a member with a password. */
async function household() {
	const test = createTestPlatform({ modules: [probe] });
	test.prepare.account({ id: "paco", role: "admin" });
	test.prepare.account({ id: "ana", role: "member" });
	await test.prepare.password("paco", PASSWORD);
	await test.prepare.password("ana", PASSWORD);
	const paco = test.context("paco");
	test.invoke(paco, "probe.addNote", { body: "comprar pan" }, { idempotencyKey: "n1" });
	return { test, paco, ana: test.context("ana") };
}

describe("probe's configure, an action of level manage", () => {
	it("answers STEP_UP_REQUIRED without a proof, and runs with one", async () => {
		const { test, paco } = await household();
		await using _ = test;

		expect(() =>
			test.invoke(paco, "probe.configure", PUBLIC, { idempotencyKey: "c1" }),
		).toThrow(stepUp);

		const { proof } = await test.requestProof(paco, PASSWORD, CONFIGURE);
		expect(
			test.invoke(paco, "probe.configure", PUBLIC, { idempotencyKey: "c1", proof }),
		).toEqual({ result: { notes: 1 }, entry: 2 });
	});

	it("does not take a proof of another operation, of another session, already used or expired at the exact millisecond", async () => {
		const { test, paco } = await household();
		await using _ = test;
		const configure = (proof: string, key: string) =>
			test.invoke(paco, "probe.configure", PUBLIC, { idempotencyKey: key, proof });

		const other = await test.requestProof(paco, PASSWORD, {
			action: "probe.configure",
			input: { visibility: "private" },
		});
		expect(() => configure(other.proof, "c1")).toThrow(stepUp);

		const elsewhere = await test.requestProof(
			test.context("paco", { session: "another-session" }),
			PASSWORD,
			CONFIGURE,
		);
		expect(() => configure(elsewhere.proof, "c2")).toThrow(stepUp);
		const onAnotherDevice = await test.requestProof(
			test.context("paco", { device: "another-device" }),
			PASSWORD,
			CONFIGURE,
		);
		expect(() => configure(onAnotherDevice.proof, "c2b")).toThrow(stepUp);

		const late = await test.requestProof(paco, PASSWORD, CONFIGURE);
		test.clock.set(late.expiresAt - 1);
		const fresh = await test.requestProof(paco, PASSWORD, CONFIGURE);
		test.clock.set(late.expiresAt);
		expect(() => configure(late.proof, "c3")).toThrow(stepUp);

		expect(configure(fresh.proof, "c4")).toMatchObject({ result: { notes: 1 } });
		expect(() => configure(fresh.proof, "c5")).toThrow(stepUp);
	});

	it("does not spend the proof of an operation that rolls back, and acknowledges a repeat with the same key", async () => {
		await using test = createTestPlatform({ modules: [probe] });
		test.prepare.account({ id: "paco", role: "admin" });
		await test.prepare.password("paco", PASSWORD);
		const paco = test.context("paco");
		const { proof } = await test.requestProof(paco, PASSWORD, CONFIGURE);

		expect(() =>
			test.invoke(paco, "probe.configure", PUBLIC, { idempotencyKey: "c1", proof }),
		).toThrow(expect.objectContaining({ code: "NO_NOTES" }));
		test.invoke(paco, "probe.addNote", { body: "comprar pan" }, { idempotencyKey: "n1" });

		expect(
			test.invoke(paco, "probe.configure", PUBLIC, { idempotencyKey: "c2", proof }),
		).toEqual({ result: { notes: 1 }, entry: 2 });
		expect(
			test.invoke(paco, "probe.configure", PUBLIC, { idempotencyKey: "c2", proof }),
		).toEqual({ entry: 2, repeated: true });
		// The repeat is authorized again, its proof included.
		expect(() =>
			test.invoke(paco, "probe.configure", PUBLIC, { idempotencyKey: "c2" }),
		).toThrow(stepUp);
	});

	it("asks for the proof when confirming, not when asking", async () => {
		const { test } = await household();
		await using _ = test;
		test.prepare.delegation("paco", "probe", "manage", "confirm");
		const kira = test.context("paco", { via: "kira" });

		const pending = pendingFrom(() =>
			test.invoke(kira, "probe.configure", PUBLIC, { idempotencyKey: "c1" }),
		);
		const paco = test.context("paco");
		expect(() => test.confirm(paco, pending)).toThrow(stepUp);

		const { proof } = await test.requestProof(paco, PASSWORD, CONFIGURE);
		expect(test.confirm(paco, pending, { proof })).toEqual({
			result: { notes: 1 },
			entry: 2,
		});
	});

	it("asks a repeat of a confirmed write for its proof again, and spends a fresh one without running twice", async () => {
		const { test } = await household();
		await using _ = test;
		test.prepare.delegation("paco", "probe", "manage", "confirm");
		const kira = test.context("paco", { via: "kira" });
		const paco = test.context("paco");
		const pending = pendingFrom(() =>
			test.invoke(kira, "probe.configure", PUBLIC, { idempotencyKey: "c1" }),
		);
		const first = await test.requestProof(paco, PASSWORD, CONFIGURE);
		expect(test.confirm(paco, pending, { proof: first.proof })).toEqual({
			result: { notes: 1 },
			entry: 2,
		});

		// Being asked to confirm counts as given on a repeat, but the proof does not.
		expect(() =>
			test.invoke(kira, "probe.configure", PUBLIC, { idempotencyKey: "c1" }),
		).toThrow(stepUp);

		const fresh = await test.requestProof(paco, PASSWORD, CONFIGURE);
		expect(
			test.invoke(kira, "probe.configure", PUBLIC, {
				idempotencyKey: "c1",
				proof: fresh.proof,
			}),
		).toEqual({ entry: 2, repeated: true });
		expect(test.log()).toHaveLength(2);
		// The repeat spent it, as a write does: it proves no other operation.
		expect(() =>
			test.invoke(paco, "probe.configure", PUBLIC, {
				idempotencyKey: "c2",
				proof: fresh.proof,
			}),
		).toThrow(stepUp);
	});

	it("is denied to an identity proven by voice or by the device, which cannot ask for a proof either", async () => {
		const { test, paco } = await household();
		await using _ = test;
		const { proof } = await test.requestProof(paco, PASSWORD, CONFIGURE);

		for (const identity of ["voice", "device"] as const) {
			const context = test.context("paco", { identity });
			expect(() =>
				test.invoke(context, "probe.configure", PUBLIC, { idempotencyKey: "c1", proof }),
			).toThrow(forbidden);
			await expect(test.requestProof(context, PASSWORD, CONFIGURE)).rejects.toMatchObject({
				code: "FORBIDDEN",
			});
		}
	});

	it("gives no proof for a wrong password or an operation that is not sensitive", async () => {
		const { test, paco } = await household();
		await using _ = test;

		await expect(test.requestProof(paco, "not my password", CONFIGURE)).rejects.toMatchObject({
			code: "FORBIDDEN",
			data: { reason: "wrong-password" },
		});
		await expect(
			test.requestProof(paco, PASSWORD, { action: "probe.addNote", input: { body: "x" } }),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		// A proof brought to an operation that does not need one does not match it.
		const { proof } = await test.requestProof(paco, PASSWORD, CONFIGURE);
		expect(() =>
			test.invoke(paco, "probe.addNote", { body: "x" }, { idempotencyKey: "a1", proof }),
		).toThrow(stepUp);
	});

	it("keeps the password and the proof out of the log, of every pending confirmation and of every error", async () => {
		const { test } = await household();
		await using _ = test;
		test.prepare.delegation("paco", "probe", "manage", "confirm");
		const paco = test.context("paco");
		const { proof } = await test.requestProof(paco, PASSWORD, CONFIGURE);
		const errors: unknown[] = [];
		const kira = test.context("paco", { via: "kira" });
		for (const call of [
			() => test.invoke(kira, "probe.configure", PUBLIC, { idempotencyKey: "c1", proof }),
			() =>
				test.invoke(
					paco,
					"probe.configure",
					{ visibility: "private" },
					{ idempotencyKey: "c2", proof },
				),
		])
			try {
				call();
			} catch (error) {
				errors.push(error);
			}
		await test.requestProof(paco, `${PASSWORD}!`, CONFIGURE).catch((error: unknown) => {
			errors.push(error);
		});
		test.invoke(paco, "probe.configure", PUBLIC, { idempotencyKey: "c3", proof });

		const seen = JSON.stringify([
			test.log(),
			errors.map((error) => ({ ...(error as object), message: String(error) })),
		]);
		expect(errors).toHaveLength(3);
		expect(seen).not.toContain(proof);
		expect(seen).not.toContain(PASSWORD);
		// The pending confirmation did not keep the proof it was asked with: confirming asks for one again.
		const pending = (errors[0] as { data: { confirmation: string } }).data.confirmation;
		expect(() => test.confirm(paco, pending)).toThrow(stepUp);
	});

	it("stores a pending confirmation asked with a proof without the proof or the password", async () => {
		const { test } = await household();
		await using _ = test;
		test.prepare.delegation("paco", "probe", "manage", "confirm");
		const kira = test.context("paco", { via: "kira" });
		const { proof } = await test.requestProof(test.context("paco"), PASSWORD, CONFIGURE);

		const id = pendingFrom(() =>
			test.invoke(kira, "probe.configure", PUBLIC, { idempotencyKey: "c1", proof }),
		);

		const stored = test.pendingConfirmations();
		expect(stored).toEqual([expect.objectContaining({ id, account: "paco" })]);
		expect(JSON.stringify(stored)).not.toContain(proof);
		expect(JSON.stringify(stored)).not.toContain(PASSWORD);
	});
});

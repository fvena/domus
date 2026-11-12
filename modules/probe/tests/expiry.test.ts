import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createTestPlatform } from "@domus/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import probe from "../server";

const DAY = 24 * 60 * 60 * 1000;

/** A platform with probe, and Ana writing through Kira. */
function probePlatform(options: { readonly file?: string; readonly retention?: number } = {}) {
	const test = createTestPlatform({ modules: [probe], ...options });
	return { test, ana: test.actor("ana", { via: "kira" }) };
}

const expired = expect.objectContaining({
	code: "UNPROCESSABLE_CONTENT",
	data: { reason: "expired" },
});
const resultExpired = expect.objectContaining({
	code: "CONFLICT",
	data: { reason: "result-expired" },
});

describe("probe expiry", () => {
	it("keeps an entry's content for 30 days from the instant it was written", async () => {
		const { test, ana } = probePlatform();
		await using _ = test;
		const at = test.clock.now();

		test.invoke(ana, "probe.addNote", { body: "comprar pan" }, { key: "k1" });

		expect(test.log()).toEqual([expect.objectContaining({ at, expiresAt: at + 30 * DAY })]);
	});

	it("answers a retry one millisecond before expiresAt with the stored result", async () => {
		const { test, ana } = probePlatform();
		await using _ = test;
		const added = test.invoke(ana, "probe.addNote", { body: "comprar pan" }, { key: "k1" });

		test.clock.set(test.log()[0]!.expiresAt - 1);

		expect(
			test.invoke(ana, "probe.addNote", { body: "comprar pan" }, { key: "k1" }),
		).toStrictEqual(added);
	});

	it("answers a retry at expiresAt and after with result-expired, without running the write", async () => {
		const { test, ana } = probePlatform();
		await using _ = test;
		test.invoke(ana, "probe.addNote", { body: "comprar pan" }, { key: "k1" });
		const { expiresAt } = test.log()[0]!;

		for (const instant of [expiresAt, expiresAt + 1, expiresAt + 365 * DAY]) {
			test.clock.set(instant);
			expect(() =>
				test.invoke(ana, "probe.addNote", { body: "comprar pan" }, { key: "k1" }),
			).toThrow(resultExpired);
		}

		expect(test.invoke(ana, "probe.listNotes")).toEqual([{ id: 1, body: "comprar pan" }]);
		expect(test.log()).toHaveLength(1);
	});

	it("authorizes an expired retry anew: denied, it answers forbidden, not result-expired", async () => {
		const { test, ana } = probePlatform();
		await using _ = test;
		test.invoke(ana, "probe.addNote", { body: "comprar pan" }, { key: "k1" });
		test.clock.set(test.log()[0]!.expiresAt);
		test.authorize("deny");

		expect(() =>
			test.invoke(ana, "probe.addNote", { body: "comprar pan" }, { key: "k1" }),
		).toThrow(expect.objectContaining({ code: "FORBIDDEN" }));
	});

	it("undoes an entry one millisecond before its expiresAt", async () => {
		const { test, ana } = probePlatform();
		await using _ = test;
		const added = test.invoke(ana, "probe.addNote", { body: "comprar pan" }, { key: "k1" });

		test.clock.set(test.log()[0]!.expiresAt - 1);
		test.undo(ana, added.entry, { key: "u1" });

		expect(test.invoke(ana, "probe.listNotes")).toEqual([]);
	});

	it("does not undo an entry at its expiresAt or after: expired, and nothing changes", async () => {
		const { test, ana } = probePlatform();
		await using _ = test;
		const added = test.invoke(ana, "probe.addNote", { body: "comprar pan" }, { key: "k1" });
		const { expiresAt } = test.log()[0]!;

		for (const [instant, key] of [
			[expiresAt, "u1"],
			[expiresAt + 1, "u2"],
		] as const) {
			test.clock.set(instant);
			expect(() => test.undo(ana, added.entry, { key })).toThrow(expired);
		}

		expect(test.invoke(ana, "probe.listNotes")).toEqual([{ id: 1, body: "comprar pan" }]);
		expect(test.log()).toEqual([expect.objectContaining({ entry: 1, undoneBy: null })]);
	});

	it("answers a retried undo whose own entry expired with result-expired", async () => {
		const { test, ana } = probePlatform();
		await using _ = test;
		const added = test.invoke(ana, "probe.addNote", { body: "comprar pan" }, { key: "k1" });
		test.clock.advance(DAY);
		const undone = test.undo(ana, added.entry, { key: "u1" });

		test.clock.set(test.log()[1]!.expiresAt - 1);
		expect(test.undo(ana, added.entry, { key: "u1" })).toStrictEqual(undone);

		test.clock.set(test.log()[1]!.expiresAt);
		expect(() => test.undo(ana, added.entry, { key: "u1" })).toThrow(resultExpired);
		expect(test.log()).toHaveLength(2);
	});

	it("keeps an entry's content for the retention the platform is given", async () => {
		const { test, ana } = probePlatform({ retention: DAY });
		await using _ = test;
		const at = test.clock.now();

		test.invoke(ana, "probe.addNote", { body: "comprar pan" }, { key: "k1" });

		expect(test.log()).toEqual([expect.objectContaining({ at, expiresAt: at + DAY })]);
	});

	describe("on a file opened again", () => {
		let dir: string;
		beforeEach(() => {
			dir = mkdtempSync(join(tmpdir(), "domus-probe-"));
		});
		afterEach(() => rmSync(dir, { recursive: true, force: true }));

		it("keeps the expiresAt of existing entries when the retention changes", async () => {
			const file = join(dir, "domus.db");
			const before = probePlatform({ file });
			const added = before.test.invoke(
				before.ana,
				"probe.addNote",
				{ body: "comprar pan" },
				{ key: "k1" },
			);
			const { expiresAt } = before.test.log()[0]!;
			before.test.close();

			const { test, ana } = probePlatform({ file, retention: DAY });
			await using _ = test;
			test.invoke(ana, "probe.addNote", { body: "regar" }, { key: "k2" });

			expect(test.log().map((entry) => entry.expiresAt)).toEqual([
				expiresAt,
				test.clock.now() + DAY,
			]);
			test.clock.set(expiresAt - 1);
			expect(
				test.invoke(ana, "probe.addNote", { body: "comprar pan" }, { key: "k1" }),
			).toStrictEqual(added);
			expect(() =>
				test.invoke(ana, "probe.addNote", { body: "regar" }, { key: "k2" }),
			).toThrow(resultExpired);
		});

		it("does not run an expired key again after a restart", async () => {
			const file = join(dir, "domus.db");
			const before = probePlatform({ file });
			before.test.invoke(before.ana, "probe.addNote", { body: "comprar pan" }, { key: "k1" });
			const { expiresAt } = before.test.log()[0]!;
			before.test.clock.set(expiresAt);
			expect(() =>
				before.test.invoke(
					before.ana,
					"probe.addNote",
					{ body: "comprar pan" },
					{ key: "k1" },
				),
			).toThrow(resultExpired);
			before.test.close();

			const { test, ana } = probePlatform({ file });
			await using _ = test;
			test.clock.set(expiresAt + DAY);

			expect(() =>
				test.invoke(ana, "probe.addNote", { body: "comprar pan" }, { key: "k1" }),
			).toThrow(resultExpired);
			expect(test.invoke(ana, "probe.listNotes")).toEqual([{ id: 1, body: "comprar pan" }]);
			expect(test.log()).toHaveLength(1);
		});
	});
});

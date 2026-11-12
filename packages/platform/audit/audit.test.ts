import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { createAudit, type NewEntry } from ".";
import { migrations } from "../migrations";
import { migrate } from "../migrator";

const AT = Date.UTC(2026, 10, 12, 9, 30);

function entry(overrides: Partial<NewEntry> = {}): NewEntry {
	return {
		module: "probe",
		action: "addNote",
		actor: { account: "ana", via: "kira" },
		key: "k1",
		fingerprint: "probe.addNote:abc",
		at: AT,
		expiresAt: AT + 1000,
		input: { body: "pan" },
		result: { id: 1, body: "pan" },
		inverse: { action: "probe.deleteNote", input: { id: 1 } },
		touched: [{ type: "note", id: 1 }],
		...overrides,
	};
}

let db: Database.Database;
afterEach(() => db.close());

/** A base on the real platform migrations: first only 0000, as the Pi had it after phase 1a, then the rest. */
function upgradedBase() {
	db = new Database(":memory:");
	expect(migrate(db, [{ module: "platform", migrations: migrations.slice(0, 1) }])).toBe(1);
	expect(migrate(db, [{ module: "platform", migrations }])).toBe(1);
	return createAudit(db);
}

describe("the action log", () => {
	it("is created by platform/0001 over a base that has only 0000, and its queries work on its tables", () => {
		const audit = upgradedBase();

		const number = db.transaction(() =>
			audit.record(
				entry({
					touched: [
						{ type: "note", id: 1 },
						{ type: "note", id: 1 },
						{ type: "tag", id: "a" },
					],
				}),
			),
		)();

		expect(number).toBe(1);
		expect(audit.entries()).toEqual([
			{
				entry: 1,
				action: "probe.addNote",
				actor: { account: "ana", via: "kira" },
				key: "k1",
				fingerprint: "probe.addNote:abc",
				at: AT,
				expiresAt: AT + 1000,
				undoes: null,
				undoneBy: null,
				input: { body: "pan" },
				result: { id: 1, body: "pan" },
				inverse: { action: "probe.deleteNote", input: { id: 1 } },
				touched: [
					{ module: "probe", type: "note", id: "1" },
					{ module: "probe", type: "tag", id: "a" },
				],
			},
		]);
	});

	it("keeps an entry without input, result or inverse apart from one whose values are null", () => {
		const audit = upgradedBase();
		db.transaction(() => {
			audit.record(
				entry({ key: "k1", input: undefined, result: undefined, inverse: undefined }),
			);
			audit.record(entry({ key: "k2", input: null, result: null }));
		})();

		expect(
			audit.entries().map(({ input, result, inverse }) => ({ input, result, inverse })),
		).toEqual([
			{ input: undefined, result: undefined, inverse: null },
			{
				input: null,
				result: null,
				inverse: { action: "probe.deleteNote", input: { id: 1 } },
			},
		]);
	});

	it("numbers entries in a sequence that never reuses a number", () => {
		const audit = upgradedBase();
		db.transaction(() => audit.record(entry({ key: "k1" })))();
		// A rolled-back entry, and then one more.
		expect(() =>
			db.transaction(() => {
				audit.record(entry({ key: "k2" }));
				throw new Error("rolled back");
			})(),
		).toThrow("rolled back");
		db.transaction(() => audit.record(entry({ key: "k3" })))();

		const numbers = audit.entries().map((logged) => logged.entry);
		expect(numbers).toHaveLength(2);
		expect(numbers[1]).toBeGreaterThan(numbers[0]!);
	});

	it("writes only inside a transaction, which it never commits itself", () => {
		const audit = upgradedBase();

		expect(() => audit.record(entry())).toThrow("only inside the action's transaction");
		expect(() =>
			db.transaction(() => {
				audit.record(entry());
				throw new Error("the action failed");
			})(),
		).toThrow("the action failed");
		expect(audit.entries()).toEqual([]);
	});

	describe("the key", () => {
		const record = (audit: ReturnType<typeof createAudit>, account: string, via?: string) =>
			db.transaction(() =>
				audit.record(entry({ actor: via === undefined ? { account } : { account, via } })),
			)();

		it("is unique per account and via", () => {
			const audit = upgradedBase();
			record(audit, "ana", "kira");

			expect(() => record(audit, "ana", "kira")).toThrow(/UNIQUE/);
		});

		it("is unique without via too: no via counts as a value of its own", () => {
			const audit = upgradedBase();
			record(audit, "ana");

			expect(() => record(audit, "ana")).toThrow(/UNIQUE/);
		});

		it("may repeat in another account, with another via, without via or with an empty via", () => {
			const audit = upgradedBase();
			record(audit, "ana", "kira");

			expect(() => {
				record(audit, "luis", "kira");
				record(audit, "ana", "panel");
				record(audit, "ana");
				record(audit, "ana", "");
			}).not.toThrow();
			expect(audit.entries()).toHaveLength(5);
		});
	});
});

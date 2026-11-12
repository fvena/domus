import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { createActionLog, type NewEntry } from ".";
import { migrations } from "../migrations";
import { migrate } from "../migrator";

const AT = Date.UTC(2026, 10, 12, 9, 30);

function entry(overrides: Partial<NewEntry> = {}): NewEntry {
	return {
		module: "probe",
		action: "addNote",
		actor: { account: "ana", via: "kira" },
		idempotencyKey: "k1",
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
	expect(migrate(db, [{ module: "platform", migrations }])).toBe(migrations.length - 1);
	return createActionLog(db);
}

describe("the action log", () => {
	it("is created by platform/0001 over a base that has only 0000, and its queries work on its tables", () => {
		const actionLog = upgradedBase();

		const number = db.transaction(() =>
			actionLog.record(
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
		expect(actionLog.entries()).toEqual([
			{
				entry: 1,
				action: "probe.addNote",
				actor: { account: "ana", via: "kira" },
				idempotencyKey: "k1",
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
		expect(actionLog.findByKey({ account: "ana", via: "kira" }, "k1")).toEqual({
			entry: 1,
			fingerprint: "probe.addNote:abc",
			expiresAt: AT + 1000,
		});
	});

	it("finds an entry by its key only for the same account and via, no via being a value of its own", () => {
		const actionLog = upgradedBase();
		db.transaction(() => {
			actionLog.record(entry({ actor: { account: "ana" } }));
			actionLog.record(entry({ actor: { account: "ana", via: "" } }));
		})();

		expect(actionLog.findByKey({ account: "ana" }, "k1")).toHaveProperty("entry", 1);
		expect(actionLog.findByKey({ account: "ana", via: "" }, "k1")).toEqual({
			entry: 2,
			fingerprint: "probe.addNote:abc",
			expiresAt: AT + 1000,
		});
		expect(actionLog.findByKey({ account: "ana", via: "kira" }, "k1")).toBeUndefined();
		expect(actionLog.findByKey({ account: "luis" }, "k1")).toBeUndefined();
		expect(actionLog.findByKey({ account: "ana" }, "k2")).toBeUndefined();
	});

	it("keeps an entry without input, result or inverse apart from one whose values are null", () => {
		const actionLog = upgradedBase();
		db.transaction(() => {
			actionLog.record(
				entry({
					idempotencyKey: "k1",
					input: undefined,
					result: undefined,
					inverse: undefined,
				}),
			);
			actionLog.record(entry({ idempotencyKey: "k2", input: null, result: null }));
		})();

		expect(
			actionLog.entries().map(({ input, result, inverse }) => ({ input, result, inverse })),
		).toEqual([
			{ input: undefined, result: undefined, inverse: null },
			{
				input: null,
				result: null,
				inverse: { action: "probe.deleteNote", input: { id: 1 } },
			},
		]);
	});

	it("finds an entry by its number, and tells whether a later one touched the same record of its module", () => {
		const actionLog = upgradedBase();
		db.transaction(() => {
			actionLog.record(entry({ idempotencyKey: "k1", touched: [{ type: "note", id: 1 }] }));
			// The same type and id in another module, and another note: neither is the same record.
			actionLog.record(
				entry({
					idempotencyKey: "k2",
					module: "other",
					touched: [{ type: "note", id: 1 }],
				}),
			);
			actionLog.record(entry({ idempotencyKey: "k3", touched: [{ type: "note", id: 2 }] }));
			actionLog.record(
				entry({
					idempotencyKey: "k4",
					inverse: undefined,
					touched: [{ type: "note", id: 2 }],
				}),
			);
		})();

		expect(actionLog.find(1)).toEqual({
			entry: 1,
			module: "probe",
			action: "probe.addNote",
			actor: { account: "ana", via: "kira" },
			idempotencyKey: "k1",
			fingerprint: "probe.addNote:abc",
			at: AT,
			expiresAt: AT + 1000,
			undoes: null,
			undoneBy: null,
			input: { body: "pan" },
			result: { id: 1, body: "pan" },
			inverse: { action: "probe.deleteNote", input: { id: 1 } },
		});
		expect(actionLog.find(4)).toHaveProperty("inverse", null);
		expect(actionLog.find(5)).toBeUndefined();
		expect([1, 2, 3, 4].map((number) => actionLog.touchedLater(number))).toEqual([
			false,
			false,
			true,
			false,
		]);
	});

	it("links an undo with the entry it undoes, once, inside a transaction", () => {
		const actionLog = upgradedBase();
		db.transaction(() => {
			actionLog.record(entry({ idempotencyKey: "k1" }));
			actionLog.record(entry({ idempotencyKey: "u1", undoes: 1 }));
			actionLog.markUndone(1, 2);
		})();

		expect(actionLog.entries().map(({ undoes, undoneBy }) => ({ undoes, undoneBy }))).toEqual([
			{ undoes: null, undoneBy: 2 },
			{ undoes: 1, undoneBy: null },
		]);
		expect(actionLog.find(1)).toHaveProperty("undoneBy", 2);
		expect(() => actionLog.markUndone(1, 2)).toThrow("only inside the action's transaction");
		expect(() => db.transaction(() => actionLog.markUndone(1, 2))()).toThrow("already undone");
		expect(() => db.transaction(() => actionLog.markUndone(9, 2))()).toThrow("missing");
	});

	it("numbers entries in a sequence that never reuses a number", () => {
		const actionLog = upgradedBase();
		db.transaction(() => actionLog.record(entry({ idempotencyKey: "k1" })))();
		// A rolled-back entry, and then one more.
		expect(() =>
			db.transaction(() => {
				actionLog.record(entry({ idempotencyKey: "k2" }));
				throw new Error("rolled back");
			})(),
		).toThrow("rolled back");
		db.transaction(() => actionLog.record(entry({ idempotencyKey: "k3" })))();

		const numbers = actionLog.entries().map((logged) => logged.entry);
		expect(numbers).toHaveLength(2);
		expect(numbers[1]).toBeGreaterThan(numbers[0]!);
	});

	it("writes only inside a transaction, which it never commits itself", () => {
		const actionLog = upgradedBase();

		expect(() => actionLog.record(entry())).toThrow("only inside the action's transaction");
		expect(() =>
			db.transaction(() => {
				actionLog.record(entry());
				throw new Error("the action failed");
			})(),
		).toThrow("the action failed");
		expect(actionLog.entries()).toEqual([]);
	});

	describe("the key", () => {
		const record = (
			actionLog: ReturnType<typeof createActionLog>,
			account: string,
			via?: string,
		) =>
			db.transaction(() =>
				actionLog.record(
					entry({ actor: via === undefined ? { account } : { account, via } }),
				),
			)();

		it("is unique per account and via", () => {
			const actionLog = upgradedBase();
			record(actionLog, "ana", "kira");

			expect(() => record(actionLog, "ana", "kira")).toThrow(/UNIQUE/);
		});

		it("is unique without via too: no via counts as a value of its own", () => {
			const actionLog = upgradedBase();
			record(actionLog, "ana");

			expect(() => record(actionLog, "ana")).toThrow(/UNIQUE/);
		});

		it("may repeat in another account, with another via, without via or with an empty via", () => {
			const actionLog = upgradedBase();
			record(actionLog, "ana", "kira");

			expect(() => {
				record(actionLog, "luis", "kira");
				record(actionLog, "ana", "panel");
				record(actionLog, "ana");
				record(actionLog, "ana", "");
			}).not.toThrow();
			expect(actionLog.entries()).toHaveLength(5);
		});
	});
});

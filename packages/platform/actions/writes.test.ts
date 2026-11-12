import { defineModule } from "@domus/module-sdk";
import { readAction, writeAction } from "@domus/module-sdk/contracts";
import { id, moduleTables, text } from "@domus/module-sdk/db";
import { ORPCError } from "@orpc/server";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { actionsOf, connectionOf, openPlatform, type Platform } from "../platform";
import { moduleDatabase, readLog, syntheticContext } from "../testing";

const { table } = moduleTables("ledger");
const items = table("items", { id: id(), body: text().notNull() });
const migrations = [
	{
		tag: "0000_ledger",
		position: 0,
		hash: "hash-of-0000_ledger",
		statements: [
			"CREATE TABLE `ledger_items` (`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL, `body` text NOT NULL);",
		],
	},
];

/** What the next `ledger.add` returns once it has inserted its item: each test sets it. */
let outcomeOf: (id: number) => unknown;

const ledger = defineModule({
	id: "ledger",
	schema: { items },
	migrations,
	contract: {
		/** Inserts an item, then returns whatever the test chose. Its result must be `{ id }`. */
		add: writeAction({ undoable: true, level: "write" })
			.input(z.any())
			.output(z.object({ id: z.number() })),
		/** Like `add`, but its contract takes any result. */
		addLoose: writeAction({ undoable: true, level: "write" }).input(z.any()).output(z.any()),
		remove: writeAction({ undoable: true, level: "write" }).input(z.object({ id: z.number() })),
		/** A write whose input schema lets anything through. */
		removeLoose: writeAction({ undoable: true, level: "write" }).input(z.any()),
		list: readAction({ level: "read" }),
		/** Its input schema throws while validating, carrying a secret in its message. */
		addThrowing: writeAction({ undoable: false, level: "write" }).input(
			z.any().refine(() => {
				throw new Error("secret: the pin is 1234");
			}),
		),
	},
	actions: {
		add: ({ db }) =>
			outcomeOf(db.insert(items).values({ body: "pan" }).returning().get().id) as never,
		addLoose: ({ db }) =>
			outcomeOf(db.insert(items).values({ body: "pan" }).returning().get().id) as never,
		remove: () => ({ result: undefined, touched: [], inverse: { action: "", input: {} } }),
		removeLoose: () => ({ result: undefined, touched: [], inverse: { action: "", input: {} } }),
		list: () => [],
		addThrowing: () => ({ result: undefined, touched: [] }),
	},
});

/** Another module, so an inverse can point outside the module of its write. */
const other = defineModule({
	id: "other",
	schema: {},
	migrations: [],
	contract: { drop: writeAction({ undoable: false, level: "write" }) },
	actions: { drop: () => ({ result: undefined, touched: [] }) },
});

const ana = syntheticContext({
	account: "ana",
	via: "kira",
	device: "d1",
	deviceAccount: "ana",
	channel: "app",
	identity: "password",
});
const NOW = Date.UTC(2026, 10, 12, 9, 30);

let platform: Platform | undefined;
afterEach(() => {
	platform?.close();
	platform = undefined;
});

function allowing() {
	platform = openPlatform(
		{ databaseFile: ":memory:", modules: [ledger, other] },
		{ authorizer: () => "allow", clock: () => NOW },
	);
	return actionsOf(platform);
}

/** Neither the change nor its entry stayed. */
function expectNothingLeft() {
	expect(moduleDatabase(platform!, ledger).select().from(items).all()).toEqual([]);
	expect(readLog(platform!)).toEqual([]);
}

const valid = (id: number) => ({
	result: { id },
	touched: [{ type: "item", id }],
	inverse: { action: "ledger.remove", input: { id } },
});

describe("a write", () => {
	it("commits its change and its entry, and returns its result and entry number without the inverse", () => {
		outcomeOf = valid;

		expect(
			allowing().invoke({
				context: ana,
				action: "ledger.add",
				input: {},
				idempotencyKey: "k1",
			}),
		).toEqual({
			result: { id: 1 },
			entry: 1,
		});
		expect(moduleDatabase(platform!, ledger).select().from(items).all()).toHaveLength(1);
		expect(readLog(platform!)).toEqual([
			expect.objectContaining({ entry: 1, action: "ledger.add", at: NOW }),
		]);
	});

	it("rejects an input with an undefined property, without running", () => {
		outcomeOf = valid;

		expect(() =>
			allowing().invoke({
				context: ana,
				action: "ledger.add",
				input: { body: undefined },
				idempotencyKey: "k1",
			}),
		).toThrow(expect.objectContaining({ code: "BAD_REQUEST" }));
		expectNothingLeft();
	});

	it.each([
		[
			"a result its contract rejects",
			"ledger.add",
			(id: number) => ({ ...valid(id), result: { id: "1" } }),
		],
		[
			"a result that is not lossless JSON",
			"ledger.addLoose",
			(id: number) => ({ ...valid(id), result: new Date(NOW) }),
		],
		[
			"no inverse, though it is undoable",
			"ledger.add",
			(id: number) => ({ result: { id }, touched: [] }),
		],
		[
			"an inverse to a read",
			"ledger.add",
			(id: number) => ({
				...valid(id),
				inverse: { action: "ledger.list", input: undefined },
			}),
		],
		[
			"an inverse to an unknown action",
			"ledger.add",
			(id: number) => ({
				...valid(id),
				inverse: { action: "ledger.missing", input: { id } },
			}),
		],
		[
			"an inverse to another module",
			"ledger.add",
			(id: number) => ({ ...valid(id), inverse: { action: "other.drop", input: undefined } }),
		],
		[
			"an inverse whose input its contract rejects",
			"ledger.add",
			(id: number) => ({
				...valid(id),
				inverse: { action: "ledger.remove", input: { id: "1" } },
			}),
		],
		[
			"an inverse whose input is not lossless JSON",
			"ledger.add",
			(id: number) => ({
				...valid(id),
				inverse: { action: "ledger.removeLoose", input: { at: new Date(NOW) } },
			}),
		],
		[
			"touched records without a type",
			"ledger.add",
			(id: number) => ({ ...valid(id), touched: [{ id }] }),
		],
		[
			"an unexpected exception",
			"ledger.add",
			() => {
				throw new Error("secret: the pin is 1234");
			},
		],
		[
			"a thenable, which an async handler returns",
			"ledger.add",
			(id: number) => Object.assign(Promise.resolve(), valid(id)),
		],
		[
			"a rejected promise, which an async handler returns",
			"ledger.add",
			(id: number) =>
				Object.assign(Promise.reject(new Error("secret: the pin is 1234")), valid(id)),
		],
		[
			"an error its contract does not declare",
			"ledger.add",
			() => {
				throw new ORPCError("NOT_DECLARED");
			},
		],
	])("rolls back, as an internal error, on %s", (_, action, outcome) => {
		outcomeOf = outcome;

		let thrown: unknown;
		try {
			allowing().invoke({ context: ana, action, input: {}, idempotencyKey: "k1" });
		} catch (error) {
			thrown = error;
		}

		expect(thrown).toHaveProperty("code", "INTERNAL_SERVER_ERROR");
		expect((thrown as Error).message).not.toContain("1234");
		expectNothingLeft();
	});

	it("fails as an internal error, without detail and without running, when validating its input throws", () => {
		outcomeOf = valid;

		let thrown: unknown;
		try {
			allowing().invoke({
				context: ana,
				action: "ledger.addThrowing",
				input: {},
				idempotencyKey: "k1",
			});
		} catch (error) {
			thrown = error;
		}

		expect(thrown).toHaveProperty("code", "INTERNAL_SERVER_ERROR");
		expect((thrown as Error).message).not.toContain("1234");
		expect((thrown as Error).stack).not.toContain("1234");
		expectNothingLeft();
	});

	it("rolls back the change and the entry when writing the log fails", () => {
		outcomeOf = valid;
		const actions = allowing();
		// The entry is written before its touched records: this fails after it.
		connectionOf(platform!).exec(
			"CREATE TRIGGER fail_touched BEFORE INSERT ON platform_action_log_touched BEGIN SELECT RAISE(ABORT, 'log down'); END",
		);

		let thrown: unknown;
		try {
			actions.invoke({ context: ana, action: "ledger.add", input: {}, idempotencyKey: "k1" });
		} catch (error) {
			thrown = error;
		}

		expect(thrown).toHaveProperty("code", "INTERNAL_SERVER_ERROR");
		expect((thrown as Error).message).not.toContain("log down");
		expectNothingLeft();
	});

	it("ends forbidden on a denial, without running or logging", () => {
		outcomeOf = valid;
		platform = openPlatform(
			{ databaseFile: ":memory:", modules: [ledger, other] },
			{ authorizer: () => "deny", clock: () => NOW },
		);

		expect(() =>
			actionsOf(platform!).invoke({
				context: ana,
				action: "ledger.add",
				input: {},
				idempotencyKey: "k1",
			}),
		).toThrow(expect.objectContaining({ code: "FORBIDDEN" }));
		expectNothingLeft();
	});

	it("asks authorization again on a retry, with the request as it came, and delivers nothing when it throws", () => {
		outcomeOf = valid;
		const requests: unknown[] = [];
		let answer: () => "allow" = () => "allow";
		platform = openPlatform(
			{ databaseFile: ":memory:", modules: [ledger, other] },
			{
				authorizer: (request) => {
					requests.push(request);
					return answer();
				},
				clock: () => NOW,
			},
		);
		const call = { context: ana, action: "ledger.add", input: {}, idempotencyKey: "k1" };
		actionsOf(platform).invoke(call);
		actionsOf(platform).invoke(call);

		const request = {
			context: ana,
			action: "ledger.add",
			permission: { area: "ledger", level: "write" },
			input: {},
		};
		expect(requests).toEqual([request, request]);

		answer = () => {
			throw new Error("authorizer down");
		};
		expect(() => actionsOf(platform!).invoke(call)).toThrow(
			expect.objectContaining({ code: "FORBIDDEN" }),
		);
		expect(readLog(platform)).toHaveLength(1);
	});
});

describe("the type of a write's handler", () => {
	it("requires the inverse only when its contract declares it undoable", () => {
		const contract = {
			undoable: writeAction({ undoable: true, level: "write" }),
			irreversible: writeAction({ undoable: false, level: "write" }),
		};
		defineModule({
			id: "typed",
			schema: {},
			migrations: [],
			contract,
			actions: {
				// @ts-expect-error: an undoable write returns its inverse.
				undoable: () => ({ result: undefined, touched: [] }),
				irreversible: () => ({ result: undefined, touched: [] }),
			},
		});
		defineModule({
			id: "typed",
			schema: {},
			migrations: [],
			contract,
			actions: {
				undoable: () => ({
					result: undefined,
					touched: [],
					inverse: { action: "typed.undoable", input: undefined },
				}),
				irreversible: () => ({
					result: undefined,
					touched: [],
					// @ts-expect-error: an irreversible write has no inverse.
					inverse: { action: "x", input: 1 },
				}),
			},
		});
	});
});

import { type Actor, defineModule, type ModuleDefinition } from "@domus/module-sdk";
import { readAction } from "@domus/module-sdk/contracts";
import { id, moduleTables, text } from "@domus/module-sdk/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { actionsOf, createPlatform, openPlatform, type Platform } from "../platform";
import { moduleDatabase } from "../testing";

const { table } = moduleTables("notes");
const items = table("items", { id: id(), body: text().notNull() });
const migrations = [
	{
		tag: "0000_notes",
		position: 0,
		hash: "hash-of-0000_notes",
		statements: [
			"CREATE TABLE `notes_items` (`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL, `body` text NOT NULL);",
		],
	},
];

const contract = {
	list: readAction().output(z.array(z.object({ id: z.number(), body: z.string() }))),
	/** Echoes what its handler receives, with an input the schema transforms. */
	context: readAction().input(z.object({ word: z.string().trim() })),
	/** A read that tries to write: a mistake the platform must stop. */
	sneakyWrite: readAction(),
	/** Throws something unexpected, carrying a secret in its message. */
	crash: readAction(),
	/** Returns what its contract does not accept. */
	badResult: readAction().output(z.object({ ok: z.literal(true) })),
	/** Accepts anything its schema lets through. */
	anything: readAction().input(z.any()),
};

const list = vi.fn((db: ReturnType<typeof moduleDatabase<{ items: typeof items }>>) =>
	db.select().from(items).all(),
);

const notes = defineModule({
	id: "notes",
	schema: { items },
	migrations,
	contract,
	actions: {
		list: ({ db }) => list(db),
		context: ({ input, actor, now, db }) => ({ input, actor, now, hasDb: db !== undefined }),
		sneakyWrite: ({ db }) => db.insert(items).values({ body: "por descuido" }).run(),
		crash: () => {
			throw new Error("secret: the pin is 1234");
		},
		badResult: () => ({ ok: false }) as never,
		anything: () => "ran",
	},
});

const ana: Actor = { account: "ana", via: "kira" };
const NOW = Date.UTC(2026, 10, 12, 9, 30);

let platform: Platform | undefined;
afterEach(() => {
	platform?.close();
	platform = undefined;
	list.mockClear();
});

function allowing(modules: readonly ModuleDefinition[] = [notes]) {
	platform = openPlatform(
		{ databaseFile: ":memory:", modules },
		{ authorizer: () => "allow", clock: () => NOW },
	);
	return actionsOf(platform);
}

describe("createPlatform", () => {
	it("denies every action, without running its handler", () => {
		platform = createPlatform({ databaseFile: ":memory:", modules: [notes] });

		expect(() => actionsOf(platform!).invoke({ actor: ana, action: "notes.list" })).toThrow(
			expect.objectContaining({ code: "FORBIDDEN" }),
		);
		expect(list).not.toHaveBeenCalled();
	});
});

describe("registering the actions", () => {
	const handler = () => [];

	it("fails at start on an action of the contract without implementation", () => {
		const broken = defineModule({
			id: "notes",
			schema: {},
			migrations: [],
			contract: { list: readAction(), count: readAction() },
			actions: { list: handler } as never,
		});

		expect(() => createPlatform({ databaseFile: ":memory:", modules: [broken] })).toThrow(
			'module "notes": action "notes.count" has no implementation',
		);
	});

	it("fails at start on an implementation without contract", () => {
		const broken = defineModule({
			id: "notes",
			schema: {},
			migrations: [],
			contract: { list: readAction() },
			actions: { list: handler, count: handler } as never,
		});

		expect(() => createPlatform({ databaseFile: ":memory:", modules: [broken] })).toThrow(
			'module "notes": action "notes.count" has no contract',
		);
	});

	it("fails at start on a full action name declared twice", () => {
		const one = defineModule({
			id: "notes",
			schema: {},
			migrations: [],
			contract: { list: readAction() },
			actions: { list: handler },
		});
		const again = defineModule({ ...one });

		expect(() => createPlatform({ databaseFile: ":memory:", modules: [one, again] })).toThrow(
			'module "notes": action "notes.list" is declared twice',
		);
	});
});

describe("a read", () => {
	it("is not found when no module declares it", () => {
		expect(() => allowing().invoke({ actor: ana, action: "notes.missing" })).toThrow(
			expect.objectContaining({ code: "NOT_FOUND" }),
		);
	});

	it("hands its handler the validated input, the actor and the clock's instant", () => {
		expect(
			allowing().invoke({ actor: ana, action: "notes.context", input: { word: "  pan " } }),
		).toEqual({ input: { word: "pan" }, actor: ana, now: NOW, hasDb: true });
	});

	it.each([
		["an undefined property", { word: undefined }],
		["a date", new Date(NOW)],
		["NaN", Number.NaN],
		["a bigint", BigInt(1)],
		["a map", new Map()],
	])("rejects an input that is not lossless JSON: %s", (_, input) => {
		expect(() => allowing().invoke({ actor: ana, action: "notes.anything", input })).toThrow(
			expect.objectContaining({ code: "BAD_REQUEST" }),
		);
	});

	it("fails when it tries to write, and leaves the connection writable afterwards", () => {
		const actions = allowing();

		expect(() => actions.invoke({ actor: ana, action: "notes.sneakyWrite" })).toThrow(
			expect.objectContaining({ code: "INTERNAL_SERVER_ERROR" }),
		);

		const db = moduleDatabase(platform!, notes);
		db.insert(items).values({ body: "a propósito" }).run();
		expect(actions.invoke({ actor: ana, action: "notes.list" })).toEqual([
			{ id: 1, body: "a propósito" },
		]);
	});

	it("turns an unexpected exception into an internal error, with no message, stack or cause of it", () => {
		let thrown: unknown;
		try {
			allowing().invoke({ actor: ana, action: "notes.crash" });
		} catch (error) {
			thrown = error;
		}

		expect(thrown).toHaveProperty("code", "INTERNAL_SERVER_ERROR");
		expect(thrown).not.toHaveProperty("cause");
		expect(JSON.stringify(thrown)).not.toContain("1234");
		expect((thrown as Error).message).not.toContain("1234");
		expect((thrown as Error).stack).not.toContain("1234");
	});

	it("fails as an internal error when its result breaks the contract", () => {
		expect(() => allowing().invoke({ actor: ana, action: "notes.badResult" })).toThrow(
			expect.objectContaining({ code: "INTERNAL_SERVER_ERROR" }),
		);
	});
});

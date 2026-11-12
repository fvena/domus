import { defineModule, type ModuleDefinition } from "@domus/module-sdk";
import { readAction } from "@domus/module-sdk/contracts";
import { id, moduleTables, text } from "@domus/module-sdk/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { actionsOf, createPlatform, openPlatform, type Platform } from "../platform";
import { moduleDatabase, prepareAccount, syntheticContext } from "../testing";

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

/** A Standard Schema whose validation throws synchronously, carrying a secret in its message. */
const throwing = {
	"~standard": {
		version: 1,
		vendor: "test",
		validate: (): never => {
			throw new Error("secret: the pin is 1234");
		},
	},
} as const;

const contract = {
	list: readAction({ level: "read" }).output(
		z.array(z.object({ id: z.number(), body: z.string() })),
	),
	/** Echoes what its handler receives, with an input the schema transforms. */
	context: readAction({ level: "read" }).input(z.object({ word: z.string().trim() })),
	/** A read that tries to write: a mistake the platform must stop. */
	sneakyWrite: readAction({ level: "read" }),
	/** Throws something unexpected, carrying a secret in its message. */
	crash: readAction({ level: "read" }),
	/** Returns what its contract does not accept. */
	badResult: readAction({ level: "read" }).output(z.object({ ok: z.literal(true) })),
	/** Accepts anything its schema lets through. */
	anything: readAction({ level: "read" }).input(z.any()),
	/** Its input schema throws while validating; zod turns that into a rejected promise. */
	rejectingInput: readAction({ level: "read" }).input(
		z.string().refine(() => {
			throw new Error("secret: the pin is 1234");
		}),
	),
	/** Its output schema throws while validating; zod turns that into a rejected promise. */
	rejectingOutput: readAction({ level: "read" }).output(
		z.string().transform(() => {
			throw new Error("secret: the pin is 1234");
		}),
	),
	/** Its input schema throws synchronously while validating. */
	throwingInput: readAction({ level: "read" }).input(throwing),
	/** Its output schema throws synchronously while validating. */
	throwingOutput: readAction({ level: "read" }).output(throwing),
	/** An async handler, which the types forbid. */
	async: readAction({ level: "read" }),
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
		rejectingInput: () => "ran",
		rejectingOutput: () => "ran",
		throwingInput: () => "ran",
		throwingOutput: () => "ran",
		async: (() => Promise.resolve("ran")) as never,
	},
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
	it("decides with the real authorization: an account that does not exist is denied, without running the handler", () => {
		platform = createPlatform({ databaseFile: ":memory:", modules: [notes] });

		expect(() => actionsOf(platform!).invoke({ context: ana, action: "notes.list" })).toThrow(
			expect.objectContaining({ code: "FORBIDDEN" }),
		);
		expect(list).not.toHaveBeenCalled();
	});

	it("runs the action of a member, whose role allows it", () => {
		platform = createPlatform({ databaseFile: ":memory:", modules: [notes] });
		prepareAccount(platform, {
			id: "ana",
			name: "Ana",
			email: "ana@domus.test",
			role: "member",
		});

		expect(actionsOf(platform).invoke({ context: ana, action: "notes.list" })).toEqual([]);
	});
});

describe("authorization", () => {
	it.each([
		["denies", () => "deny" as const],
		[
			"throws",
			() => {
				throw new Error("authorizer down");
			},
		],
		["answers something else", () => "maybe" as never],
	])("ends forbidden without running the handler when it %s", (_, authorizer) => {
		platform = openPlatform(
			{ databaseFile: ":memory:", modules: [notes] },
			{ authorizer, clock: () => NOW },
		);

		expect(() => actionsOf(platform!).invoke({ context: ana, action: "notes.list" })).toThrow(
			expect.objectContaining({ code: "FORBIDDEN" }),
		);
		expect(list).not.toHaveBeenCalled();
	});

	it("is asked with the verified context, the action, the permission its contract declares and the validated input", () => {
		const requests: unknown[] = [];
		platform = openPlatform(
			{ databaseFile: ":memory:", modules: [notes] },
			{
				authorizer: (request) => {
					requests.push(request);
					return "allow";
				},
				clock: () => NOW,
			},
		);

		actionsOf(platform).invoke({
			context: ana,
			action: "notes.context",
			input: { word: " pan " },
		});

		expect(requests).toEqual([
			{
				context: ana,
				action: "notes.context",
				permission: { area: "notes", level: "read" },
				input: { word: "pan" },
			},
		]);
	});
});

describe("registering the actions", () => {
	const handler = () => [];

	it("fails at start on an action of the contract without implementation", () => {
		const broken = defineModule({
			id: "notes",
			schema: {},
			migrations: [],
			contract: { list: readAction({ level: "read" }), count: readAction({ level: "read" }) },
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
			contract: { list: readAction({ level: "read" }) },
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
			contract: { list: readAction({ level: "read" }) },
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
		expect(() => allowing().invoke({ context: ana, action: "notes.missing" })).toThrow(
			expect.objectContaining({ code: "NOT_FOUND" }),
		);
	});

	it("hands its handler the validated input, the actor of its context and the clock's instant", () => {
		expect(
			allowing().invoke({ context: ana, action: "notes.context", input: { word: "  pan " } }),
		).toEqual({
			input: { word: "pan" },
			actor: { account: "ana", via: "kira" },
			now: NOW,
			hasDb: true,
		});
	});

	it("does not run with a context it did not verify, however faithful the copy", () => {
		expect(() =>
			allowing().invoke({
				context: { ...ana },
				action: "notes.context",
				input: { word: "pan" },
			}),
		).toThrow(expect.objectContaining({ code: "INTERNAL_SERVER_ERROR" }));
	});

	it.each([
		["an undefined property", { word: undefined }],
		["a date", new Date(NOW)],
		["NaN", Number.NaN],
		["a bigint", BigInt(1)],
		["a map", new Map()],
	])("rejects an input that is not lossless JSON: %s", (_, input) => {
		expect(() => allowing().invoke({ context: ana, action: "notes.anything", input })).toThrow(
			expect.objectContaining({ code: "BAD_REQUEST" }),
		);
	});

	it("fails when it tries to write, and leaves the connection writable afterwards", () => {
		const actions = allowing();

		expect(() => actions.invoke({ context: ana, action: "notes.sneakyWrite" })).toThrow(
			expect.objectContaining({ code: "INTERNAL_SERVER_ERROR" }),
		);

		const db = moduleDatabase(platform!, notes);
		db.insert(items).values({ body: "a propósito" }).run();
		expect(actions.invoke({ context: ana, action: "notes.list" })).toEqual([
			{ id: 1, body: "a propósito" },
		]);
	});

	it.each([
		["its handler", "notes.crash", undefined],
		["validating its input", "notes.throwingInput", "pan"],
		["validating its result", "notes.throwingOutput", undefined],
		["validating its input, as a rejected promise", "notes.rejectingInput", "pan"],
		["validating its result, as a rejected promise", "notes.rejectingOutput", undefined],
	])(
		"turns an unexpected exception in %s into an internal error, with no message, stack or cause of it",
		(_, action, input) => {
			let thrown: unknown;
			try {
				allowing().invoke({ context: ana, action, input });
			} catch (error) {
				thrown = error;
			}

			expect(thrown).toHaveProperty("code", "INTERNAL_SERVER_ERROR");
			expect(thrown).not.toHaveProperty("cause");
			expect(JSON.stringify(thrown)).not.toContain("1234");
			expect((thrown as Error).message).not.toContain("1234");
			expect((thrown as Error).stack).not.toContain("1234");
		},
	);

	it("fails as an internal error when its handler returns a thenable", () => {
		expect(() => allowing().invoke({ context: ana, action: "notes.async" })).toThrow(
			expect.objectContaining({ code: "INTERNAL_SERVER_ERROR" }),
		);
	});

	it("fails as an internal error when its result breaks the contract", () => {
		expect(() => allowing().invoke({ context: ana, action: "notes.badResult" })).toThrow(
			expect.objectContaining({ code: "INTERNAL_SERVER_ERROR" }),
		);
	});
});

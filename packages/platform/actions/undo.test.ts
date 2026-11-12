import { defineModule } from "@domus/module-sdk";
import { writeAction } from "@domus/module-sdk/contracts";
import { eq, id, moduleTables, text } from "@domus/module-sdk/db";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import type { AuthorizationRequest } from "../authorization";
import { actionsOf, connectionOf, openPlatform, type Platform } from "../platform";
import { moduleDatabase, readLog, syntheticContext } from "../testing";

const { table } = moduleTables("shelf");
const books = table("books", { id: id(), title: text().notNull() });

const shelf = defineModule({
	id: "shelf",
	schema: { books },
	migrations: [
		{
			tag: "0000_shelf",
			position: 0,
			hash: "hash-of-0000_shelf",
			statements: [
				"CREATE TABLE `shelf_books` (`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL, `title` text NOT NULL);",
			],
		},
	],
	contract: {
		add: writeAction({ undoable: true, level: "write" })
			.input(z.object({ title: z.string() }))
			.output(z.object({ id: z.number() })),
		remove: writeAction({ undoable: false, level: "write" }).input(
			z.object({ id: z.number() }),
		),
	},
	actions: {
		add: ({ db, input }) => {
			const { id } = db.insert(books).values(input).returning().get();
			return {
				result: { id },
				touched: [{ type: "book", id }],
				inverse: { action: "shelf.remove", input: { id } },
			};
		},
		remove: ({ db, input }) => {
			db.delete(books).where(eq(books.id, input.id)).run();
			return { result: undefined, touched: [{ type: "book", id: input.id }] };
		},
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

let platform: Platform | undefined;
afterEach(() => {
	platform?.close();
	platform = undefined;
});

describe("an undo", () => {
	it("reauthorizes a retry with the inverse its own entry ran, not with the content of the entry it undid", () => {
		const requests: AuthorizationRequest[] = [];
		platform = openPlatform(
			{ databaseFile: ":memory:", modules: [shelf] },
			{
				authorizer: (request) => {
					requests.push(request);
					return "allow";
				},
				clock: () => Date.UTC(2026, 10, 12),
			},
		);
		const actions = actionsOf(platform);
		actions.invoke({
			context: ana,
			action: "shelf.add",
			input: { title: "Niebla" },
			idempotencyKey: "k1",
		});
		requests.length = 0;
		const undone = actions.undo({ context: ana, entry: 1, idempotencyKey: "u1" });
		// The content of the undone entry is gone, as phase 1d leaves expired content.
		connectionOf(platform).exec(
			"UPDATE platform_action_log SET input = NULL, result = NULL, inverse = NULL WHERE entry = 1",
		);

		expect(actions.undo({ context: ana, entry: 1, idempotencyKey: "u1" })).toStrictEqual(
			undone,
		);
		// The inverse, with the permission of its own contract and the context of the entry it undoes: the
		// same request the first time and on the retry.
		const request = {
			context: ana,
			action: "shelf.remove",
			permission: { area: "shelf", level: "write" },
			input: { id: 1 },
			undoes: { entry: 1, action: "shelf.add", actor: { account: "ana", via: "kira" } },
		};
		expect(requests).toEqual([request, request]);
	});

	it("runs the inverse with exactly the input it authorized, transformed by its contract once", () => {
		const { table: boardTable } = moduleTables("board");
		const notes = boardTable("notes", { id: id(), title: text().notNull() });
		const received: unknown[] = [];
		const board = defineModule({
			id: "board",
			schema: { notes },
			migrations: [
				{
					tag: "0000_board",
					position: 0,
					hash: "hash-of-0000_board",
					statements: [
						"CREATE TABLE `board_notes` (`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL, `title` text NOT NULL);",
					],
				},
			],
			contract: {
				post: writeAction({ undoable: true, level: "write" })
					.input(z.object({ title: z.string() }))
					.output(z.object({ id: z.number() })),
				// Its transforms change a type and a value: a second pass would reject the id or add another "!".
				retitle: writeAction({ undoable: false, level: "write" }).input(
					z.object({
						id: z.string().transform(Number),
						title: z.string().transform((title) => `${title}!`),
					}),
				),
			},
			actions: {
				post: ({ db, input }) => {
					const { id } = db.insert(notes).values(input).returning().get();
					return {
						result: { id },
						touched: [{ type: "note", id }],
						inverse: {
							action: "board.retitle",
							input: { id: String(id), title: "borrador" },
						},
					};
				},
				retitle: ({ db, input }) => {
					received.push(input);
					db.update(notes)
						.set({ title: input.title })
						.where(eq(notes.id, input.id))
						.run();
					return { result: undefined, touched: [{ type: "note", id: input.id }] };
				},
			},
		});
		const requests: AuthorizationRequest[] = [];
		platform = openPlatform(
			{ databaseFile: ":memory:", modules: [board] },
			{
				authorizer: (request) => {
					requests.push(request);
					return "allow";
				},
				clock: () => Date.UTC(2026, 10, 12),
			},
		);
		const actions = actionsOf(platform);
		actions.invoke({
			context: ana,
			action: "board.post",
			input: { title: "lista" },
			idempotencyKey: "k1",
		});
		requests.length = 0;

		actions.undo({ context: ana, entry: 1, idempotencyKey: "u1" });

		expect(requests.map((request) => request.input)).toEqual([{ id: 1, title: "borrador!" }]);
		expect(received).toEqual([{ id: 1, title: "borrador!" }]);
		expect(moduleDatabase(platform, board).select().from(notes).all()).toEqual([
			{ id: 1, title: "borrador!" },
		]);
	});

	it("rolls back the inverse, its entry and the undone-by link together when something fails", () => {
		platform = openPlatform(
			{ databaseFile: ":memory:", modules: [shelf] },
			{ authorizer: () => "allow", clock: () => Date.UTC(2026, 10, 12) },
		);
		const actions = actionsOf(platform);
		actions.invoke({
			context: ana,
			action: "shelf.add",
			input: { title: "Niebla" },
			idempotencyKey: "k1",
		});
		const before = readLog(platform);
		// Linking the undone entry is the last step: this fails after the inverse ran and was logged.
		connectionOf(platform).exec(
			"CREATE TRIGGER fail_undone_by BEFORE UPDATE OF undone_by ON platform_action_log BEGIN SELECT RAISE(ABORT, 'log down'); END",
		);

		let thrown: unknown;
		try {
			actions.undo({ context: ana, entry: 1, idempotencyKey: "u1" });
		} catch (error) {
			thrown = error;
		}

		expect(thrown).toHaveProperty("code", "INTERNAL_SERVER_ERROR");
		expect((thrown as Error).message).not.toContain("log down");
		expect(moduleDatabase(platform, shelf).select().from(books).all()).toEqual([
			{ id: 1, title: "Niebla" },
		]);
		expect(readLog(platform)).toEqual(before);
	});
});

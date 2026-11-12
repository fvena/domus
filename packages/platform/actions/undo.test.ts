import { type Actor, defineModule } from "@domus/module-sdk";
import { writeAction } from "@domus/module-sdk/contracts";
import { eq, id, moduleTables, text } from "@domus/module-sdk/db";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { actionsOf, connectionOf, openPlatform, type Platform } from "../platform";
import { moduleDatabase, readLog } from "../testing";

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
		add: writeAction({ undoable: true })
			.input(z.object({ title: z.string() }))
			.output(z.object({ id: z.number() })),
		remove: writeAction({ undoable: false }).input(z.object({ id: z.number() })),
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

const ana: Actor = { account: "ana", via: "kira" };

let platform: Platform | undefined;
afterEach(() => {
	platform?.close();
	platform = undefined;
});

describe("an undo", () => {
	it("rolls back the inverse, its entry and the undone-by link together when something fails", () => {
		platform = openPlatform(
			{ databaseFile: ":memory:", modules: [shelf] },
			{ authorizer: () => "allow", clock: () => Date.UTC(2026, 10, 12) },
		);
		const actions = actionsOf(platform);
		actions.invoke({ actor: ana, action: "shelf.add", input: { title: "Niebla" }, key: "k1" });
		const before = readLog(platform);
		// Linking the undone entry is the last step: this fails after the inverse ran and was logged.
		connectionOf(platform).exec(
			"CREATE TRIGGER fail_undone_by BEFORE UPDATE OF undone_by ON platform_action_log BEGIN SELECT RAISE(ABORT, 'log down'); END",
		);

		let thrown: unknown;
		try {
			actions.undo({ actor: ana, entry: 1, key: "u1" });
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

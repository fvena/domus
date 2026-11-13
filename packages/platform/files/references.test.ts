// What `ctx.files` refuses as a mistake of the module (spec of phase 1d3, «`ctx.files` y `fileRef()`»): changing
// files from a read, and any table that is not an owned table of the module itself. Both are internal errors,
// never an answer of authorization. A module written here, `album`, has what probe cannot show: a read that tries
// to change files, a plain table and another module's owned table at hand.
import { defineModule } from "@domus/module-sdk";
import { readAction, writeAction } from "@domus/module-sdk/contracts";
import { id, moduleTables, text } from "@domus/module-sdk/db";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { actionsOf, openPlatform, type Platform } from "../platform";
import { syntheticContext } from "../testing";

const OPERATIONS = ["attach", "detach", "reattach"] as const;

const album = moduleTables("album");
const photos = album.ownedTable(
	"photos",
	{ type: "photo", area: "album" },
	{
		body: text().notNull(),
	},
);
const tags = album.table("tags", { id: id() });

const shelf = moduleTables("shelf");
const books = shelf.ownedTable(
	"books",
	{ type: "book", area: "shelf" },
	{
		body: text().notNull(),
	},
);

const operation = z.object({ operation: z.enum(OPERATIONS) });

const albumModule = defineModule({
	id: "album",
	areas: { album: {} },
	schema: { photos, tags },
	migrations: [
		{
			tag: "0000_album",
			position: 0,
			hash: "hash-of-0000_album",
			statements: [
				"CREATE TABLE `album_photos` (`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL, `body` text NOT NULL, `owner` text NOT NULL, `visibility` text NOT NULL);",
				"CREATE TABLE `album_tags` (`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL);",
			],
		},
	],
	contract: {
		/** A read that tries to change a photo's files. */
		peek: readAction({ level: "read" }).input(operation),
		/** A write that changes the files of another module's book. */
		onBook: writeAction({ undoable: false, level: "write" }).input(operation),
		/** A write that lists the files of another module's book. */
		listBook: writeAction({ undoable: false, level: "write" }),
		/** A write that changes the files of a row of a plain table. */
		onTag: writeAction({ undoable: false, level: "write" }),
	},
	actions: {
		peek: ({ input, files }) => {
			files[input.operation]("file", { table: photos, id: 1 });
			return undefined;
		},
		onBook: ({ input, files }) => {
			files[input.operation]("file", { table: books, id: 1 });
			return { result: undefined, touched: [] };
		},
		listBook: ({ files }) => {
			files.of(books, 1);
			return { result: undefined, touched: [] };
		},
		onTag: ({ files }) => {
			// @ts-expect-error a plain table has no owner, so no record of it can have files
			files.attach("file", { table: tags, id: 1 });
			return { result: undefined, touched: [] };
		},
	},
});

const shelfModule = defineModule({
	id: "shelf",
	areas: { shelf: {} },
	schema: { books },
	migrations: [
		{
			tag: "0000_shelf",
			position: 0,
			hash: "hash-of-0000_shelf",
			statements: [
				"CREATE TABLE `shelf_books` (`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL, `body` text NOT NULL, `owner` text NOT NULL, `visibility` text NOT NULL);",
			],
		},
	],
	contract: {},
	actions: {},
});

const ana = syntheticContext({
	account: "ana",
	device: "d1",
	deviceAccount: "ana",
	channel: "app",
	identity: "password",
});
const NOW = Date.UTC(2026, 10, 13, 9, 30);

let platform: Platform | undefined;
afterEach(() => {
	platform?.close();
	platform = undefined;
});

function allowing() {
	platform = openPlatform(
		{ databaseFile: ":memory:", modules: [albumModule, shelfModule] },
		{ authorizer: () => "allow", clock: () => NOW },
	);
	return actionsOf(platform);
}

describe("ctx.files", () => {
	it.each(OPERATIONS)("refuses %s from a read as the module's mistake", (name) => {
		expect(() =>
			allowing().invoke({
				context: ana,
				action: "album.peek",
				input: { operation: name },
			}),
		).toThrow(expect.objectContaining({ code: "INTERNAL_SERVER_ERROR" }));
	});

	it.each(OPERATIONS)(
		"refuses %s on another module's owned table as the module's mistake",
		(name) => {
			expect(() =>
				allowing().invoke({
					context: ana,
					action: "album.onBook",
					input: { operation: name },
					idempotencyKey: "k1",
				}),
			).toThrow(expect.objectContaining({ code: "INTERNAL_SERVER_ERROR" }));
		},
	);

	it("refuses listing the files of another module's owned table as the module's mistake", () => {
		expect(() =>
			allowing().invoke({
				context: ana,
				action: "album.listBook",
				input: undefined,
				idempotencyKey: "k1",
			}),
		).toThrow(expect.objectContaining({ code: "INTERNAL_SERVER_ERROR" }));
	});

	it("refuses a plain table of its own module as the module's mistake", () => {
		expect(() =>
			allowing().invoke({
				context: ana,
				action: "album.onTag",
				input: undefined,
				idempotencyKey: "k1",
			}),
		).toThrow(expect.objectContaining({ code: "INTERNAL_SERVER_ERROR" }));
	});
});

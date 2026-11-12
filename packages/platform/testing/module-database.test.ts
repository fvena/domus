import { defineModule } from "@domus/module-sdk";
import { id, moduleTables, text } from "@domus/module-sdk/db";
import { describe, expect, it } from "vitest";

import { createPlatform } from "../platform";
import { moduleDatabase } from "./module-database";

const { table } = moduleTables("notes");
const items = table("items", { id: id(), body: text().notNull() });
const notes = defineModule({
	id: "notes",
	schema: { items },
	migrations: [
		{
			tag: "0000_notes",
			position: 0,
			hash: "hash-of-0000_notes",
			statements: [
				"CREATE TABLE `notes_items` (`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL, `body` text NOT NULL);",
			],
		},
	],
});

describe("moduleDatabase", () => {
	it("reads and writes the tables of a module the platform received", () => {
		const platform = createPlatform({ databaseFile: ":memory:", modules: [notes] });
		const db = moduleDatabase(platform, notes);

		db.insert(items).values({ body: "leche" }).run();

		expect(db.query.items.findMany().sync()).toEqual([{ id: 1, body: "leche" }]);
		platform.close();
	});

	it("rejects a module the platform did not receive", () => {
		const platform = createPlatform({ databaseFile: ":memory:", modules: [] });
		expect(() => moduleDatabase(platform, notes)).toThrow(
			'module "notes" is not one of this platform\'s modules',
		);
		platform.close();
	});
});

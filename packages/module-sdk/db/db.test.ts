import { getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";

import { id, moduleTables, text } from "./index";

const { table } = moduleTables("probe");

describe("moduleTables", () => {
	it("prefixes each table with the module id", () => {
		const notes = table("notes", { body: text().notNull() });

		expect(getTableName(notes)).toBe("probe_notes");
	});
});

describe("id", () => {
	it("is an INTEGER PRIMARY KEY AUTOINCREMENT named after its key", () => {
		const notes = table("notes", { id: id() });

		const [column] = getTableConfig(notes).columns;
		expect(column).toMatchObject({ name: "id", primary: true, autoIncrement: true });
		expect(column?.getSQLType()).toBe("integer");
	});
});

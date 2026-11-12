// Every real module of `modules/`, probe included, composed with the platform on a temporary file (ADR 0021):
// their migrations apply, no foreign key leaves its module, and every table carries a registered prefix.
// tooling may compose the real modules; platform and test-utils never import one.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createPlatform } from "@domus/platform";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadModules } from "./module-list";

const root = join(import.meta.dirname, "../..");

let directory: string;
let db: Database.Database;
let ids: string[];

beforeAll(async () => {
	const definitions = (await loadModules(root)).map((module) => module.definition);
	ids = definitions.map((definition) => definition.id);
	directory = mkdtempSync(join(tmpdir(), "domus-real-modules-"));
	const databaseFile = join(directory, "domus.db");
	createPlatform({ databaseFile, modules: definitions }).close();
	db = new Database(databaseFile, { readonly: true, fileMustExist: true });
});

afterAll(() => {
	db?.close();
	if (directory) rmSync(directory, { recursive: true, force: true });
});

function tables(): string[] {
	return db
		.prepare<[], { name: string }>(
			"SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'",
		)
		.all()
		.map((row) => row.name);
}

/** The registered owner of a table by its prefix: `platform` or a module id. */
function ownerOf(table: string): string | undefined {
	return ["platform", ...ids].find((owner) => table.startsWith(`${owner}_`));
}

describe("the real modules", () => {
	it("apply every migration on a file", () => {
		const applied = db
			.prepare<[], { module: string; tag: string }>(
				"SELECT module, tag FROM platform_migrations ORDER BY module, position",
			)
			.all();
		expect(applied).toContainEqual({ module: "platform", tag: "0000_migration_history" });
		expect(applied).toContainEqual({ module: "platform", tag: "0001_action_log" });
		expect(new Set(applied.map((row) => row.module))).toEqual(new Set(["platform", ...ids]));
	});

	it("keep every table under platform_ or a registered module's prefix", () => {
		expect(tables()).toContain("probe_notes");
		expect(tables().filter((table) => ownerOf(table) === undefined)).toEqual([]);
	});

	it("never point a foreign key at another module's table", () => {
		const crossing = tables().flatMap((table) =>
			db
				.prepare<[string], { table: string }>(
					`SELECT "table" FROM pragma_foreign_key_list(?)`,
				)
				.all(table)
				.filter((key) => ownerOf(key.table) !== ownerOf(table))
				.map((key) => `${table} -> ${key.table}`),
		);
		expect(crossing).toEqual([]);
	});

	it("check a foreign key that exists: probe_comments -> probe_notes", () => {
		const keys = db
			.prepare<[string], { table: string }>(`SELECT "table" FROM pragma_foreign_key_list(?)`)
			.all("probe_comments");
		expect(keys).toEqual([{ table: "probe_notes" }]);
	});
});

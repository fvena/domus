// Turns the migrations drizzle-kit writes into `packages/platform/migrations/` into
// `packages/platform/generated-migrations.ts` (ADR 0023). The first one is the base: it stands for the
// hand-written platform/0000 + platform/0001 and exists only so drizzle-kit has something to start from. It is
// checked against those two and left out; the next ones get their positions after the hand-written ones, under
// the name drizzle-kit gave them.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";

import type { ModuleMigration } from "@domus/module-sdk";
import Database from "better-sqlite3";
import { readMigrationFiles } from "drizzle-orm/migrator";

import {
	type Journal,
	type MigrationFile,
	renderMigrations,
	toModuleMigrations,
} from "./module-migrations";

/** The source of `generated-migrations.ts` for the platform's `migrations/` folder, formatted with Oxfmt. */
export function platformMigrationsSource(
	folder: string,
	handWritten: readonly ModuleMigration[],
): string {
	const journal = JSON.parse(readFileSync(join(folder, "meta/_journal.json"), "utf8")) as Journal;
	const files = readMigrationFiles({ migrationsFolder: folder });
	return renderMigrations(
		{
			comment:
				"// Written by `pnpm db:generate` from `migrations/`, leaving out its base (ADR 0023). Do not edit: change\n" +
				"// `schema.ts` and generate.",
			name: "generatedMigrations",
			migrations: toPlatformMigrations(journal, files, handWritten),
		},
		join(folder, "../generated-migrations.ts"),
	);
}

/**
 * The platform's generated migrations that run: all but the base, each at its journal place plus the
 * hand-written ones the base stands for. Throws when there is no base or its schema is not theirs.
 */
export function toPlatformMigrations(
	journal: Journal,
	files: readonly MigrationFile[],
	handWritten: readonly ModuleMigration[],
): ModuleMigration[] {
	const [base, ...rest] = toModuleMigrations(journal, files);
	if (!base)
		throw new Error(
			"the platform's migrations folder has no base: its first migration must stand for the hand-written ones",
		);
	const difference = schemaDifference(
		schemaOf(handWritten.flatMap((migration) => migration.statements)),
		schemaOf(base.statements, `the base "${base.tag}"`),
	);
	if (difference)
		throw new Error(
			`the base "${base.tag}" does not have the schema of ${handWritten.map((m) => `platform/${m.tag.slice(0, 4)}`).join(" + ")}: ${difference}`,
		);
	return rest.map((migration) => ({
		...migration,
		position: migration.position - 1 + handWritten.length,
	}));
}

/** One table or index of a schema, as SQLite reports it, so two ways of writing the same one compare equal. */
export type SchemaItem =
	| {
			readonly type: "table";
			readonly name: string;
			readonly columns: readonly unknown[];
			readonly foreignKeys: readonly unknown[];
			readonly uniques: readonly unknown[];
			readonly autoincrement: boolean;
			readonly options: unknown;
	  }
	| {
			readonly type: "index";
			readonly name: string;
			readonly table: string;
			readonly sql: string;
	  };

/** The schema `statements` leave on an empty database, ordered by kind and name. */
export function schemaOf(statements: readonly string[], what = "the statements"): SchemaItem[] {
	const db = new Database(":memory:");
	try {
		for (const statement of statements) {
			try {
				db.exec(statement);
			} catch (error) {
				throw new Error(
					`${what} fail on an empty database: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}
		const objects = db
			.prepare<[], { type: string; name: string; tbl_name: string; sql: string | null }>(
				"SELECT type, name, tbl_name, sql FROM sqlite_master " +
					"WHERE type IN ('table', 'index') AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY type DESC, name",
			)
			.all();
		return objects.map(({ type, name, tbl_name, sql }) =>
			type === "table"
				? describeTable(db, name, sql ?? "")
				: { type: "index", name, table: tbl_name, sql: normalize(sql ?? "") },
		);
	} finally {
		db.close();
	}
}

function describeTable(db: Database.Database, name: string, sql: string): SchemaItem {
	const pragma = (query: string) => db.prepare(query).all(name);
	// Each UNIQUE constraint by its columns: the names SQLite gives them follow the order they were written in.
	const uniques = (
		pragma("SELECT name FROM pragma_index_list(?) WHERE origin = 'u'") as { name: string }[]
	)
		.map((index) =>
			(
				db
					.prepare("SELECT name FROM pragma_index_info(?) ORDER BY seqno")
					.pluck()
					.all(index.name) as string[]
			).join(","),
		)
		.sort((a, b) => a.localeCompare(b));
	return {
		type: "table",
		name,
		columns: pragma(
			'SELECT name, type, "notnull", dflt_value, pk, hidden FROM pragma_table_xinfo(?) ORDER BY cid',
		),
		foreignKeys: pragma(
			'SELECT seq, "table", "from", "to", on_update, on_delete, "match" FROM pragma_foreign_key_list(?) ORDER BY "from", seq',
		),
		uniques,
		autoincrement: /\bAUTOINCREMENT\b/i.test(sql),
		options: pragma('SELECT "type", ncol, wr, strict FROM pragma_table_list(?)'),
	};
}

/** An index's SQL with its identifiers unquoted and its spacing evened out. */
function normalize(sql: string): string {
	return sql
		.replace(/[`"]([A-Za-z_][A-Za-z0-9_$]*)[`"]/g, "$1")
		.replace(/\s+/g, " ")
		.replace(/\s*([(),;])\s*/g, "$1")
		.trim();
}

/** The first way `actual` differs from `expected`, in words, or undefined when they are the same. */
function schemaDifference(
	expected: readonly SchemaItem[],
	actual: readonly SchemaItem[],
): string | undefined {
	for (const item of expected) {
		const other = actual.find((candidate) => candidate.name === item.name);
		if (!other) return `${item.type} ${item.name} is missing from the base`;
		if (!isDeepStrictEqual(item, other)) return `${item.type} ${item.name} differs`;
	}
	const extra = actual.find((item) => !expected.some((other) => other.name === item.name));
	return extra ? `${extra.type} ${extra.name} is only in the base` : undefined;
}

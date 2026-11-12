// `pnpm db:generate` also writes the platform's migrations (ADR 0023): drizzle-kit's first one is the base,
// which stands for the hand-written platform/0000 + platform/0001 and never runs; the next ones get their
// positions from 2 on, under their generated names.
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { generatedMigrations } from "../../packages/platform/generated-migrations";
import { handWrittenMigrations } from "../../packages/platform/hand-written-migrations";
import { migrate } from "../../packages/platform/migrator";
import { drizzleKitGenerate } from "./drizzle-kit";
import type { Journal, MigrationFile } from "./module-migrations";
import { schemaOf, toPlatformMigrations } from "./platform-migrations";

const realFolder = join(import.meta.dirname, "../../packages/platform/migrations");

function read(folder: string): { journal: Journal; files: MigrationFile[] } {
	const journal = JSON.parse(readFileSync(join(folder, "meta/_journal.json"), "utf8")) as Journal;
	return { journal, files: readMigrationFiles({ migrationsFolder: folder }) };
}

/** The real folder, as drizzle-kit wrote it. */
const real = read(realFolder);

/** The real base, alone. */
const base = {
	journal: { entries: real.journal.entries.slice(0, 1) },
	files: real.files.slice(0, 1),
};

describe("the base", () => {
	it("is the platform's first generated migration, and nothing of it runs", () => {
		expect(toPlatformMigrations(base.journal, base.files, handWrittenMigrations)).toEqual([]);
	});

	it("leaves the real generated migrations to run from position 2 on", () => {
		const generated = toPlatformMigrations(real.journal, real.files, handWrittenMigrations);
		expect(generated).toEqual(generatedMigrations);
		expect(generated.map((migration) => migration.position)).toEqual(
			generated.map((_, index) => index + 2),
		);
	});

	it("has the schema platform/0000 + platform/0001 create", () => {
		const fromBase = schemaOf(base.files[0]!.sql);
		const fromHandWritten = schemaOf(handWrittenMigrations.flatMap((m) => m.statements));
		expect(fromBase).toEqual(fromHandWritten);
		expect(fromBase.map((item) => item.name)).toContain("platform_action_log_key_unique");
	});

	it("is refused when its schema differs from platform/0000 + platform/0001", () => {
		const [file] = base.files;
		const other = {
			...file!,
			sql: file!.sql.map((statement) => statement.replace("ifnull(\"via\", '')", '"via"')),
		};
		expect(() => toPlatformMigrations(base.journal, [other], handWrittenMigrations)).toThrow(
			`the base "${base.journal.entries[0]!.tag}" does not have the schema of platform/0000 + platform/0001: ` +
				"index platform_action_log_key_unique differs",
		);
	});

	it("is refused when a table is missing from it", () => {
		const [file] = base.files;
		const other = {
			...file!,
			sql: file!.sql.filter((statement) => !statement.includes("platform_migrations")),
		};
		expect(() => toPlatformMigrations(base.journal, [other], handWrittenMigrations)).toThrow(
			"table platform_migrations is missing from the base",
		);
	});

	it("is required: a platform with no generated migration is an error", () => {
		expect(() => toPlatformMigrations({ entries: [] }, [], handWrittenMigrations)).toThrow(
			"the platform's migrations folder has no base",
		);
	});
});

describe("a migration generated after the base", () => {
	let folder: string;
	let generated: ReturnType<typeof toPlatformMigrations>;

	beforeAll(() => {
		// A copy of the real folder, and a schema that adds one table to the platform's.
		folder = mkdtempSync(join(tmpdir(), "domus-platform-migrations-"));
		cpSync(realFolder, folder, { recursive: true });
		drizzleKitGenerate(join(import.meta.dirname, "fixtures/platform-schema/schema.ts"), folder);
		const { journal, files } = read(folder);
		generated = toPlatformMigrations(journal, files, handWrittenMigrations);
	}, 60_000);

	afterAll(() => {
		if (folder) rmSync(folder, { recursive: true, force: true });
	});

	it("gets the next position under the name drizzle-kit gave it", () => {
		const { journal } = read(folder);
		const last = journal.entries.length - 1;
		const [added, ...none] = generated.slice(generatedMigrations.length);
		expect(generated.slice(0, generatedMigrations.length)).toEqual(generatedMigrations);
		expect(none).toEqual([]);
		expect(added).toMatchObject({ tag: journal.entries[last]!.tag, position: last + 1 });
		expect(added!.tag).toMatch(new RegExp(`^${String(last).padStart(4, "0")}_`));
	});

	it("leaves the same schema on a clean install and on a database of phase 1b", () => {
		const platform = [...handWrittenMigrations, ...generated];

		const clean = new Database(":memory:");
		expect(migrate(clean, [{ module: "platform", migrations: platform }])).toBe(
			2 + generated.length,
		);

		const of1b = new Database(":memory:");
		migrate(of1b, [{ module: "platform", migrations: handWrittenMigrations }]);
		expect(migrate(of1b, [{ module: "platform", migrations: platform }])).toBe(
			generated.length,
		);

		const schema = (db: Database.Database) =>
			schemaOf(
				db
					.prepare<[], { sql: string }>(
						"SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY rowid",
					)
					.all()
					.map((row) => row.sql),
			);
		expect(schema(of1b)).toEqual(schema(clean));
		expect(schema(clean).map((item) => item.name)).toContain("platform_sample");
	});
});

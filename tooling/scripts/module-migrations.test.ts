// `pnpm db:generate` turns drizzle-kit's migrations into `server/migrations.ts` (ADR 0021).
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { readMigrationFiles } from "drizzle-orm/migrator";
import { describe, expect, it } from "vitest";

import { type Journal, migrationsSource, toModuleMigrations } from "./module-migrations";

const sample = join(import.meta.dirname, "fixtures/migrations/sample");
const journal = JSON.parse(readFileSync(join(sample, "meta/_journal.json"), "utf8")) as Journal;
const files = readMigrationFiles({ migrationsFolder: sample });

describe("migrationsSource", () => {
	it("writes the migrations of the journal, with their statements and hashes", () => {
		const expected = readFileSync(join(sample, "expected.ts"), "utf8");
		expect(migrationsSource(sample)).toBe(expected);
	});

	it("gives the same file every time", () => {
		expect(migrationsSource(sample)).toBe(migrationsSource(sample));
	});
});

describe("toModuleMigrations", () => {
	it("fails when readMigrationFiles and the journal have a different number of migrations", () => {
		const longer = { entries: [...journal.entries, { idx: 2, when: 1, tag: "0002_extra" }] };
		expect(() => toModuleMigrations(longer, files)).toThrow(
			"readMigrationFiles gave 2 migrations and _journal.json has 3",
		);
	});

	it("fails when readMigrationFiles and the journal are in a different order", () => {
		expect(() => toModuleMigrations(journal, [...files].reverse())).toThrow(
			'readMigrationFiles and _journal.json disagree at position 0 ("0000_violet_loners")',
		);
	});

	it("fails when a journal entry is out of place", () => {
		const [first, second] = journal.entries;
		const swapped = {
			entries: [
				{ ...second!, when: first!.when },
				{ ...first!, when: second!.when },
			],
		};
		expect(() => toModuleMigrations(swapped, files)).toThrow(
			'_journal.json: "0001_clean_bullseye" has idx 1 at position 0',
		);
	});
});

describe("transaction control in a migration", () => {
	// One migration whose SQL file holds these statements, as readMigrationFiles would read it.
	function migrationWith(...statements: string[]) {
		const one = { entries: [{ idx: 0, when: 1, tag: "0000_sample" }] };
		return () =>
			toModuleMigrations(one, [{ sql: statements, bps: true, folderMillis: 1, hash: "h" }]);
	}

	it.each([
		["BEGIN;", "BEGIN"],
		["COMMIT;", "COMMIT"],
		["ROLLBACK;", "ROLLBACK"],
		["SAVEPOINT x;", "SAVEPOINT"],
		["RELEASE x;", "RELEASE"],
		["END;", "END"],
		["begin transaction;", "BEGIN"],
		["CREATE TABLE `a` (`x` integer);\nCOMMIT;", "COMMIT"],
		["-- a comment first\n/* and another */ ROLLBACK", "ROLLBACK"],
	])("rejects %j", (statement, keyword) => {
		expect(migrationWith("CREATE TABLE `b` (`y` integer);", statement)).toThrow(
			`migration "0000_sample", statement 2: ${keyword} controls the transaction`,
		);
	});

	it.each([
		["a comment that says begin", "-- begin with the table\nCREATE TABLE `a` (`x` integer);"],
		["a block comment", "/* COMMIT; */ CREATE TABLE `a` (`x` integer);"],
		["a string that says COMMIT", "INSERT INTO `a` (`x`) VALUES ('COMMIT; it''s fine');"],
		["a quoted identifier", 'CREATE TABLE "begin" (`x` integer);'],
		[
			"the BEGIN … END of a trigger",
			"CREATE TRIGGER `a_touch` AFTER UPDATE ON `a` BEGIN\n" +
				"\tUPDATE `a` SET `x` = CASE WHEN NEW.`x` > 0 THEN 1 ELSE 0 END WHERE rowid = NEW.rowid;\n" +
				"END;",
		],
	])("accepts %s", (_, statement) => {
		expect(migrationWith(statement)).not.toThrow();
	});
});

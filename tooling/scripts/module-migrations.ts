// Turns the migrations drizzle-kit writes into a module's `server/migrations/` into `server/migrations.ts`,
// the data `defineModule` carries and the platform's runner applies (ADR 0021).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

import type { ModuleMigration } from "@domus/module-sdk";
import { readMigrationFiles } from "drizzle-orm/migrator";

const root = join(import.meta.dirname, "../..");
const oxfmt = join(createRequire(import.meta.url).resolve("oxfmt/package.json"), "../bin/oxfmt");

interface JournalEntry {
	readonly idx: number;
	readonly when: number;
	readonly tag: string;
}

/** What drizzle-kit writes in `meta/_journal.json`, as far as the generator reads it. */
export interface Journal {
	readonly entries: readonly JournalEntry[];
}

/** One entry of what `readMigrationFiles` returns. */
export type MigrationFile = ReturnType<typeof readMigrationFiles>[number];

/** The source of `server/migrations.ts` for a module's `migrations/` folder, formatted with Oxfmt. */
export function migrationsSource(folder: string): string {
	const journal = JSON.parse(readFileSync(join(folder, "meta/_journal.json"), "utf8")) as Journal;
	const files = readMigrationFiles({ migrationsFolder: folder });
	return render(toModuleMigrations(journal, files), join(folder, "../migrations.ts"));
}

/**
 * Pairs what `readMigrationFiles` read with the journal it read it from: the statements and the hash come
 * from the first, the tag and the position from the second. Throws when the two stop matching, as they could
 * in another version of Drizzle.
 */
export function toModuleMigrations(
	journal: Journal,
	files: readonly MigrationFile[],
): ModuleMigration[] {
	if (files.length !== journal.entries.length)
		throw new Error(
			`readMigrationFiles gave ${files.length} migrations and _journal.json has ${journal.entries.length}: ` +
				"check how the installed drizzle-orm reads the journal",
		);
	return journal.entries.map((entry, position) => {
		const file = files[position]!;
		if (entry.idx !== position)
			throw new Error(
				`_journal.json: "${entry.tag}" has idx ${entry.idx} at position ${position}`,
			);
		if (file.folderMillis !== entry.when)
			throw new Error(
				`readMigrationFiles and _journal.json disagree at position ${position} ("${entry.tag}"): ` +
					"check how the installed drizzle-orm reads the journal",
			);
		file.sql.forEach((statement, index) => {
			const keyword = transactionControl(statement);
			if (keyword)
				throw new Error(
					`migration "${entry.tag}", statement ${index + 1}: ${keyword} controls the transaction, ` +
						"and the platform applies every migration inside its own",
				);
		});
		return { tag: entry.tag, position, hash: file.hash, statements: file.sql };
	});
}

const TRANSACTION_CONTROL = new Set(["BEGIN", "COMMIT", "END", "ROLLBACK", "SAVEPOINT", "RELEASE"]);

/**
 * The first statement in `sql` that controls the transaction, by its keyword, or undefined. It reads
 * statements, not words: comments, strings and quoted names are skipped, and the `BEGIN … END` body of a
 * `CREATE TRIGGER` belongs to that one statement.
 */
function transactionControl(sql: string): string | undefined {
	let words: string[] = [];
	let trigger: "no" | "head" | "body" | "done" = "no";
	let caseDepth = 0;
	for (const token of tokens(sql)) {
		if (token === ";") {
			// Inside a trigger's body, a `;` ends one of its statements, not the trigger.
			if (trigger !== "body") {
				words = [];
				trigger = "no";
			}
			continue;
		}
		if (words.length === 0 && trigger === "no" && TRANSACTION_CONTROL.has(token)) return token;
		words.push(token);
		if (trigger === "no" && isCreateTrigger(words)) trigger = "head";
		else if (trigger === "head" && token === "BEGIN") trigger = "body";
		else if (trigger === "body" && token === "CASE") caseDepth++;
		else if (trigger === "body" && token === "END") {
			if (caseDepth > 0) caseDepth--;
			else trigger = "done";
		}
	}
	return undefined;
}

function isCreateTrigger(words: readonly string[]): boolean {
	if (words[0] !== "CREATE") return false;
	return (
		words[1] === "TRIGGER" ||
		((words[1] === "TEMP" || words[1] === "TEMPORARY") && words[2] === "TRIGGER")
	);
}

const QUOTE_END: Readonly<Record<string, string>> = { "'": "'", '"': '"', "`": "`", "[": "]" };

/** The words of `sql`, upper-cased, and its `;`, leaving out comments, strings and quoted names. */
function* tokens(sql: string): Generator<string> {
	let at = 0;
	while (at < sql.length) {
		const char = sql[at]!;
		if (sql.startsWith("--", at)) at = endOf(sql, "\n", at + 2);
		else if (sql.startsWith("/*", at)) at = endOf(sql, "*/", at + 2);
		else if (char in QUOTE_END) at = endOf(sql, QUOTE_END[char]!, at + 1);
		else if (char === ";") {
			yield ";";
			at++;
		} else if (/[A-Za-z_]/.test(char)) {
			const word = /^[A-Za-z0-9_$]+/.exec(sql.slice(at))![0];
			yield word.toUpperCase();
			at += word.length;
		} else at++;
	}
}

/** The index just past the next `close` from `from`, or the end of `sql`. A doubled quote reads as two strings. */
function endOf(sql: string, close: string, from: number): number {
	const found = sql.indexOf(close, from);
	return found === -1 ? sql.length : found + close.length;
}

/** The source of `target`, formatted by the Oxfmt CLI with the repository's config, as `pnpm format` would. */
function render(migrations: readonly ModuleMigration[], target: string): string {
	const source = [
		"// Written by `pnpm db:generate` from `migrations/` (ADR 0021). Do not edit: change `schema.ts` and generate.",
		'import type { ModuleMigration } from "@domus/module-sdk";',
		"",
		`export const migrations: readonly ModuleMigration[] = ${JSON.stringify(migrations)};`,
		"",
	].join("\n");
	return execFileSync(process.execPath, [oxfmt, `--stdin-filepath=${target}`], {
		cwd: root,
		input: source,
		encoding: "utf8",
	});
}

// The migration runner (ADR 0021): the platform's migrations and then each module's, in the order of the
// list, in one transaction for the whole start. Plain better-sqlite3, nothing internal to Drizzle.
import type { ModuleMigration } from "@domus/module-sdk";
import type Database from "better-sqlite3";

/** One owner of migrations: the platform or a module, by the name its history rows carry. */
export interface MigrationSource {
	readonly module: string;
	readonly migrations: readonly ModuleMigration[];
}

interface AppliedRow {
	readonly module: string;
	readonly position: number;
	readonly tag: string;
	readonly hash: string;
}

const HISTORY_TABLE = "platform_migrations";

/**
 * Checks the history against the code, then applies what is pending. Returns how many migrations it
 * applied. On any error nothing is applied: schema, data and history stay as they were.
 */
export function migrate(db: Database.Database, sources: readonly MigrationSource[]): number {
	const pending = pendingMigrations(readHistory(db), sources);
	if (pending.length === 0) return 0;

	// Outside the transaction: inside one, SQLite ignores it, and so it ignores the same pragmas drizzle-kit
	// writes around a table rebuild.
	db.pragma("foreign_keys = OFF");
	try {
		db.exec("BEGIN");
		try {
			let sequences = readSequences(db);
			for (const { module, migration } of pending) {
				try {
					for (const statement of migration.statements) db.exec(statement);
				} catch (error) {
					throw new Error(
						`module "${module}": migration "${migration.tag}" failed: ${messageOf(error)}`,
					);
				}
				// Prepared each time: before platform/0000 runs, the history table does not exist yet.
				db.prepare(
					`INSERT INTO ${HISTORY_TABLE} (module, position, tag, hash, applied_at) VALUES (?, ?, ?, ?, ?)`,
				).run(module, migration.position, migration.tag, migration.hash, Date.now());
				// After each migration, so the next one cannot take an id a rebuild in this one lost.
				restoreSequences(db, sequences);
				sequences = readSequences(db);
			}
			checkForeignKeys(db);
			db.exec("COMMIT");
		} catch (error) {
			if (db.inTransaction) db.exec("ROLLBACK");
			throw error;
		}
	} finally {
		db.pragma("foreign_keys = ON");
	}
	return pending.length;
}

function readHistory(db: Database.Database): AppliedRow[] {
	if (!tableExists(db, HISTORY_TABLE)) return [];
	return db
		.prepare(
			`SELECT module, position, tag, hash FROM ${HISTORY_TABLE} ORDER BY module, position`,
		)
		.all() as AppliedRow[];
}

/**
 * For each source, what is applied must be an exact prefix of what the code brings: same tag, position and
 * hash. Rejects, naming module and migration, before anything changes.
 */
function pendingMigrations(
	history: readonly AppliedRow[],
	sources: readonly MigrationSource[],
): { module: string; migration: ModuleMigration }[] {
	const known = new Set(sources.map((source) => source.module));
	const gone = history.find((row) => !known.has(row.module));
	if (gone)
		throw new Error(
			`module "${gone.module}": migration "${gone.tag}" is applied, but the module is not in the module list`,
		);

	const pending = [];
	for (const { module, migrations } of sources) {
		const applied = history.filter((row) => row.module === module);
		applied.forEach((row, index) => checkApplied(module, row, migrations, index));
		for (const migration of migrations.slice(applied.length))
			pending.push({ module, migration });
	}
	return pending;
}

function checkApplied(
	module: string,
	row: AppliedRow,
	migrations: readonly ModuleMigration[],
	index: number,
): void {
	const inCode = migrations.find((migration) => migration.tag === row.tag);
	if (!inCode)
		throw new Error(
			`module "${module}": migration "${row.tag}" is applied, but it is missing from the code`,
		);
	if (inCode !== migrations[index] || inCode.position !== row.position)
		throw new Error(
			`module "${module}": migration "${row.tag}" was applied at position ${row.position}, but the code has it at position ${inCode.position}`,
		);
	if (inCode.hash !== row.hash)
		throw new Error(
			`module "${module}": migration "${row.tag}" was applied with another hash: it changed after being applied`,
		);
}

/**
 * `AUTOINCREMENT` keeps the highest id a table ever had in `sqlite_sequence`. A table rebuild (create the new
 * table, copy, drop the old one, rename) loses it when the highest ids were deleted, and ids would be reused.
 */
function readSequences(db: Database.Database): Map<string, number> {
	if (!tableExists(db, "sqlite_sequence")) return new Map();
	const rows = db.prepare("SELECT name, seq FROM sqlite_sequence").raw().all() as [
		string,
		number,
	][];
	return new Map(rows);
}

/** After the migrations, no table that still uses AUTOINCREMENT counts below what it had before. */
function restoreSequences(db: Database.Database, before: ReadonlyMap<string, number>): void {
	for (const [name, seq] of before) {
		const table = db
			.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
			.pluck()
			.get(name) as string | undefined;
		if (!table || !/\bAUTOINCREMENT\b/i.test(table)) continue;

		const now = db
			.prepare("SELECT seq FROM sqlite_sequence WHERE name = ?")
			.pluck()
			.get(name) as number | undefined;
		if (now === undefined)
			db.prepare("INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)").run(name, seq);
		else if (now < seq)
			db.prepare("UPDATE sqlite_sequence SET seq = ? WHERE name = ?").run(seq, name);
	}
}

interface ForeignKeyViolation {
	readonly table: string;
	readonly rowid: number | null;
	readonly parent: string;
}

function checkForeignKeys(db: Database.Database): void {
	const violations = db.pragma("foreign_key_check") as ForeignKeyViolation[];
	if (violations.length === 0) return;
	const shown = violations
		.slice(0, 5)
		.map(({ table, rowid, parent }) => `"${table}" row ${String(rowid)} → "${parent}"`)
		.join(", ");
	const more = violations.length > 5 ? ` and ${violations.length - 5} more` : "";
	throw new Error(`migrations left rows that break a foreign key: ${shown}${more}`);
}

function tableExists(db: Database.Database, name: string): boolean {
	return (
		db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !==
		undefined
	);
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

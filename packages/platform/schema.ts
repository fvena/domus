// The platform's tables in Drizzle (ADR 0023), all under the `platform_` prefix. `pnpm db:generate` writes the
// platform's migrations from here into `migrations/`. The first one it wrote is the base: it stands for the
// hand-written platform/0000 and platform/0001, which created the tables declared below, and it never runs.
// The ones after it change those tables: platform/0002 drops the action log's result column (ADR 0023).
// platform/audit keeps reading and writing these tables with prepared statements.
import { sql } from "drizzle-orm";
import {
	type AnySQLiteColumn,
	index,
	integer,
	primaryKey,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";

/** platform/0000: which migration of which owner is applied, at which position and with which hash. */
export const migrationHistory = sqliteTable(
	"platform_migrations",
	{
		module: text().notNull(),
		position: integer().notNull(),
		tag: text().notNull(),
		hash: text().notNull(),
		appliedAt: integer("applied_at").notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.module, table.position] }),
		uniqueIndex("platform_migrations_module_tag_unique").on(table.module, table.tag),
	],
);

/**
 * platform/0001: the action log (ADR 0022). The key is unique per account and via, with no via as a value
 * of its own: `via IS NULL` tells it apart from an empty via. Its content is the input and the inverse: since
 * platform/0002 it keeps no result (ADR 0023).
 */
export const actionLog = sqliteTable(
	"platform_action_log",
	{
		entry: integer().primaryKey({ autoIncrement: true }),
		module: text().notNull(),
		action: text().notNull(),
		account: text().notNull(),
		via: text(),
		key: text().notNull(),
		fingerprint: text().notNull(),
		at: integer().notNull(),
		expiresAt: integer("expires_at").notNull(),
		undoes: integer().references((): AnySQLiteColumn => actionLog.entry),
		undoneBy: integer("undone_by").references((): AnySQLiteColumn => actionLog.entry),
		input: text(),
		inverse: text(),
	},
	(table) => [
		uniqueIndex("platform_action_log_key_unique").on(
			table.account,
			sql`${table.via} IS NULL`,
			// `ifnull(via, '')`, cut at its comma: drizzle-kit 0.31 joins a SQLite index's columns with commas
			// and splits them again, so an expression with a comma goes in pieces that join back whole.
			sql`ifnull(${table.via}`,
			sql` '')`,
			table.key,
		),
	],
);

/** platform/0001: the records each entry of the log touched, indexed by record so undo finds the later entries. */
export const actionLogTouched = sqliteTable(
	"platform_action_log_touched",
	{
		entry: integer()
			.notNull()
			.references(() => actionLog.entry),
		module: text().notNull(),
		type: text().notNull(),
		id: text().notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.entry, table.module, table.type, table.id] }),
		index("platform_action_log_touched_record").on(
			table.module,
			table.type,
			table.id,
			table.entry,
		),
	],
);

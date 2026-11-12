// What a module needs to declare its tables (ADR 0021). Modules never import drizzle-orm: they take it from here.
// sqliteTable is not offered: every table comes from moduleTables, which puts the module's prefix on it.
import { integer, sqliteTableCreator } from "drizzle-orm/sqlite-core";

export { eq, sql } from "drizzle-orm";
export {
	blob,
	check,
	foreignKey,
	index,
	integer,
	numeric,
	primaryKey,
	real,
	text,
	unique,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";

/** The table function of one module: each table it makes is named `<id>_<name>`. */
export function moduleTables(id: string) {
	return { table: sqliteTableCreator((name) => `${id}_${name}`) };
}

/**
 * The default key: `INTEGER PRIMARY KEY AUTOINCREMENT`, which never reuses an id committed in the same table.
 * Not required: a table may use a composite key or ids an integration imposes.
 */
export function id() {
	return integer().primaryKey({ autoIncrement: true });
}

// What a module needs to declare its tables (ADR 0021, ADR 0023). Modules never import drizzle-orm: they take it
// from here. sqliteTable is not offered: every table comes from moduleTables, which puts the module's prefix on
// it, and an owned table also gets its owner and visibility columns from it.
import { type BuildExtraConfigColumns, sql } from "drizzle-orm";
import {
	type AnySQLiteColumn,
	check,
	integer,
	type SQLiteColumnBuilderBase,
	type SQLiteTable,
	type SQLiteTableExtraConfigValue,
	sqliteTableCreator,
	text,
} from "drizzle-orm/sqlite-core";

import type { AreaDefinition, Visibility } from "../areas";

export type { Visibility } from "../areas";
export { and, asc, count, eq, sql } from "drizzle-orm";
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

const VISIBILITIES = ["private", "public"] as const satisfies readonly Visibility[];

/** What the platform knows of an owned table: its record type and its area, with the area's policy it was built for. */
export interface OwnedTableInfo {
	/** The name of its records, as a write's touched records give it, such as `note`. Unique in its module. */
	readonly type: string;
	/** Its area's full id. */
	readonly area: string;
	/** True when built for an `alwaysPrivate` area: a `CHECK` rejects a public row. */
	readonly alwaysPrivate: boolean;
}

/** Marks an owned table. `Symbol.for`, so the platform reads the mark of a table any copy of this file made. */
const OWNED: unique symbol = Symbol.for("domus.ownedTable");

/**
 * The columns every owned table has, added by `ownedTable`: the integer key, the owner (the account that
 * created the record) and its visibility.
 */
function ownedColumns() {
	return {
		id: id(),
		owner: text().notNull(),
		visibility: text({ enum: VISIBILITIES }).notNull(),
	};
}

type OwnedColumns = ReturnType<typeof ownedColumns>;
const RESERVED = ["id", "owner", "visibility"] as const;

/** The table functions of one module: each table it makes is named `<id>_<name>`. */
export function moduleTables<
	const TId extends string,
	const TAreas extends Readonly<Record<string, AreaDefinition>> = Record<never, never>,
>(moduleId: TId, areas?: TAreas) {
	const table = sqliteTableCreator((name) => `${moduleId}_${name}`);

	/**
	 * A table whose records have an owner and a visibility (ADR 0023). It adds the integer `id` key and the
	 * `owner` and `visibility` columns to `columns`, which must not name them, and a `CHECK` on visibility:
	 * `private` only, when its area is `alwaysPrivate`. `area` is the module's own or one of `areas`; `type`
	 * names its records. Its key is always `id` alone: start rejects any other.
	 */
	function ownedTable<
		TName extends string,
		TColumns extends Record<string, SQLiteColumnBuilderBase>,
	>(
		name: TName,
		{ type, area }: { readonly type: string; readonly area: TId | (keyof TAreas & string) },
		columns: TColumns & { readonly [TKey in (typeof RESERVED)[number]]?: never },
		extraConfig?: (
			self: BuildExtraConfigColumns<TName, TColumns & OwnedColumns, "sqlite">,
		) => SQLiteTableExtraConfigValue[],
	) {
		for (const key of RESERVED)
			if (key in columns)
				throw new Error(
					`owned table "${moduleId}_${name}": "${key}" is a column every owned table already has`,
				);
		const alwaysPrivate = areas?.[area]?.alwaysPrivate === true;
		const { id: key, owner, visibility } = ownedColumns();
		const made = table(
			name,
			{ id: key, ...columns, owner, visibility } as TColumns & OwnedColumns,
			(self) => [
				// The column by its bare name: drizzle-kit would qualify it with the table's name, which is a
				// temporary one when it rebuilds the table.
				check(
					`${moduleId}_${name}_visibility`,
					alwaysPrivate
						? sql`${sql.identifier("visibility")} = 'private'`
						: sql`${sql.identifier("visibility")} in ('private', 'public')`,
				),
				// The same columns; drizzle types the one it hands over by their final names.
				...(extraConfig?.(self as never) ?? []),
			],
		);
		const info: OwnedTableInfo = { type, area, alwaysPrivate };
		Object.defineProperty(made, OWNED, { value: info });
		return made as typeof made & { readonly [OWNED]: OwnedTableInfo };
	}

	return { table, ownedTable };
}

/** A table made by `ownedTable`: its `id`, `owner` and `visibility` columns, and its mark. */
export type OwnedTable = SQLiteTable & {
	readonly [OWNED]: OwnedTableInfo;
	readonly id: AnySQLiteColumn;
	readonly owner: AnySQLiteColumn;
	readonly visibility: AnySQLiteColumn;
};

/** What an owned table declares, or `undefined` for anything else. */
export function ownedTableOf(value: unknown): OwnedTableInfo | undefined {
	if (typeof value !== "object" || value === null || !(OWNED in value)) return undefined;
	return (value as { readonly [OWNED]: OwnedTableInfo })[OWNED];
}

/**
 * The default key: `INTEGER PRIMARY KEY AUTOINCREMENT`, which never reuses an id committed in the same table.
 * Not required: a table may use a composite key or ids an integration imposes; an owned table may not.
 */
export function id() {
	return integer().primaryKey({ autoIncrement: true });
}

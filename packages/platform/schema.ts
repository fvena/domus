// The platform's tables in Drizzle (ADR 0023), all under the `platform_` prefix. `pnpm db:generate` writes the
// platform's migrations from here into `migrations/`. The first one it wrote is the base: it stands for the
// hand-written platform/0000 and platform/0001, which created the tables declared below, and it never runs.
// The ones after it change those tables: platform/0002 drops the action log's result column (ADR 0023).
// platform/audit keeps reading and writing these tables with prepared statements.
import { sql } from "drizzle-orm";
import {
	type AnySQLiteColumn,
	check,
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

// Identity (ADR 0023). Better Auth reads and writes the next four tables through its Drizzle adapter, by these
// JS property names; their SQL columns are snake_case. Only email and password: `verification` stays empty,
// but Better Auth checks that it exists.

/** An account: a member or the one device account. Better Auth calls it user. */
export const user = sqliteTable("platform_user", {
	id: text().primaryKey(),
	name: text().notNull(),
	email: text().notNull().unique(),
	emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
	image: text(),
	createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
	updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

/** A device: a browser installed or, later, a satellite. It outlives its sessions and can change account. */
export const devices = sqliteTable("platform_devices", {
	id: text().primaryKey(),
	createdAt: integer("created_at").notNull(),
	name: text(),
});

/** A session of an account from a device. Which device is kept here, on the server, never read from a cookie. */
export const session = sqliteTable(
	"platform_session",
	{
		id: text().primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		deviceId: text("device_id")
			.notNull()
			.references(() => devices.id),
		token: text().notNull().unique(),
		expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
		ipAddress: text("ip_address"),
		userAgent: text("user_agent"),
		createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
	},
	(table) => [index("platform_session_user").on(table.userId)],
);

/** How an account signs in: only `credential`, with its password hash. The device account has none. */
export const account = sqliteTable(
	"platform_account",
	{
		id: text().primaryKey(),
		accountId: text("account_id").notNull(),
		providerId: text("provider_id").notNull(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		accessToken: text("access_token"),
		refreshToken: text("refresh_token"),
		idToken: text("id_token"),
		accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp_ms" }),
		refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp_ms" }),
		scope: text(),
		password: text(),
		createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
	},
	(table) => [index("platform_account_user").on(table.userId)],
);

/** Required by Better Auth; nothing of email and password writes it in Domus. */
export const verification = sqliteTable("platform_verification", {
	id: text().primaryKey(),
	identifier: text().notNull(),
	value: text().notNull(),
	expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
	createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
	updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

/** The role of each account: `admin`, `member` or `device`. There is exactly one device account. */
export const roles = sqliteTable(
	"platform_roles",
	{
		account: text()
			.primaryKey()
			.references(() => user.id, { onDelete: "cascade" }),
		role: text({ enum: ["admin", "member", "device"] }).notNull(),
	},
	(table) => [
		check("platform_roles_role", sql`${table.role} IN ('admin', 'member', 'device')`),
		uniqueIndex("platform_roles_one_device")
			.on(table.role)
			.where(sql`${table.role} = 'device'`),
	],
);

/** A row that replaces the default of an account's role in one area: `none`, `read`, `write` or `manage`. */
export const permissions = sqliteTable(
	"platform_permissions",
	{
		account: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		area: text().notNull(),
		level: text({ enum: ["none", "read", "write", "manage"] }).notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.account, table.area] }),
		check(
			"platform_permissions_level",
			sql`${table.level} IN ('none', 'read', 'write', 'manage')`,
		),
	],
);

/**
 * The delegation table (ADR 0023): what an account lets Kira do on its behalf, one row per area and level, each
 * `no`, `yes` or `confirm` on its own. Written once when the account is created; an area without a row is `no`.
 */
export const delegation = sqliteTable(
	"platform_delegation",
	{
		account: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		area: text().notNull(),
		level: text({ enum: ["read", "write", "manage"] }).notNull(),
		value: text({ enum: ["no", "yes", "confirm"] }).notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.account, table.area, table.level] }),
		check("platform_delegation_level", sql`${table.level} IN ('read', 'write', 'manage')`),
		check("platform_delegation_value", sql`${table.value} IN ('no', 'yes', 'confirm')`),
	],
);

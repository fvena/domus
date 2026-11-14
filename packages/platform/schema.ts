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

/**
 * A device: a browser installed or, later, a satellite. It outlives its sessions and can change account. `entry` is
 * a random value written anew each time a session enters it, before that session is created (ADR 0029): the session
 * whose `deviceEntry` equals it is the one the device has enabled for notices, and none when none does.
 */
export const devices = sqliteTable("platform_devices", {
	id: text().primaryKey(),
	createdAt: integer("created_at").notNull(),
	name: text(),
	entry: text(),
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
		/** The `entry` its device got when this session entered it: equal to the device's while it is enabled. */
		deviceEntry: text("device_entry"),
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

/**
 * A pending confirmation (ADR 0023): an operation that waits for the person to confirm it. It keeps the exact
 * operation (`operation`, with its fingerprint), whether it reads or writes, a write's idempotency key, the
 * verified context it was born in and its two absolute deadlines: the voice window and its expiry. `session` is
 * the session it was born in while that session lives: revoking it sets it to null, which ends a pending
 * confirmation that was `bound` to one. `context_only` marks one born of the shared device rule: only the
 * channel `contexto` confirms it, and it expires when its window closes. `entry` links a confirmed write to its
 * entry in the action log. The cleanup (ADR 0025) empties `operation` once it expired and keeps the rest, which
 * still decides the answer.
 */
export const confirmations = sqliteTable(
	"platform_confirmations",
	{
		id: text().primaryKey(),
		account: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		via: text(),
		kind: text({ enum: ["read", "write"] }).notNull(),
		operation: text(),
		fingerprint: text().notNull(),
		key: text(),
		origin: text().notNull(),
		session: text().references(() => session.id, { onDelete: "set null" }),
		bound: integer({ mode: "boolean" }).notNull(),
		createdAt: integer("created_at").notNull(),
		windowClosesAt: integer("window_closes_at").notNull(),
		expiresAt: integer("expires_at").notNull(),
		contextOnly: integer("context_only", { mode: "boolean" }).notNull().default(false),
		state: text({ enum: ["pending", "consumed", "rejected", "ended"] }).notNull(),
		entry: integer().references(() => actionLog.entry),
	},
	(table) => [
		index("platform_confirmations_account_key").on(table.account, table.key),
		index("platform_confirmations_session").on(table.session),
		check("platform_confirmations_kind", sql`${table.kind} IN ('read', 'write')`),
		check(
			"platform_confirmations_state",
			sql`${table.state} IN ('pending', 'consumed', 'rejected', 'ended')`,
		),
	],
);

/**
 * A step-up proof (ADR 0023): what giving the password again earns for one exact sensitive operation. Only the
 * SHA-256 of the proof is kept, never the proof. It is bound to the account, the session it was asked from
 * (`origin_session`, and `session` while that one lives: revoking it sets it to null, which ends a proof that
 * was `bound` to a real session), the device and the operation's fingerprint. It is good once, until
 * `expires_at`; `entry` links it to the write that used it, so a repeat of that write is acknowledged.
 */
export const proofs = sqliteTable(
	"platform_proofs",
	{
		hash: text().primaryKey(),
		account: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		session: text().references(() => session.id, { onDelete: "set null" }),
		originSession: text("origin_session"),
		bound: integer({ mode: "boolean" }).notNull(),
		device: text().notNull(),
		fingerprint: text().notNull(),
		createdAt: integer("created_at").notNull(),
		expiresAt: integer("expires_at").notNull(),
		state: text({ enum: ["issued", "used", "ended"] }).notNull(),
		entry: integer().references(() => actionLog.entry),
	},
	(table) => [
		index("platform_proofs_account").on(table.account),
		index("platform_proofs_session").on(table.session),
		index("platform_proofs_device").on(table.device),
		check("platform_proofs_state", sql`${table.state} IN ('issued', 'used', 'ended')`),
	],
);

// Background work (ADR 0025): the jobs of the engine, the state of each scheduled task and the log of their runs.
// platform/background reads and writes them with prepared statements.

/**
 * A scheduled task's state, one row per task the platform ever declared: the time the admin chose, if any, whether
 * it is paused, and the absolute instant of its next planned run. A row of a task the code no longer declares
 * stays and is ignored.
 */
export const tasks = sqliteTable("platform_tasks", {
	id: text().primaryKey(),
	time: text(),
	paused: integer({ mode: "boolean" }).notNull().default(false),
	nextAt: integer("next_at").notNull(),
});

/**
 * One run of a scheduled task. A planned run is unique by its task and local planned date (`YYYY-MM-DD` in the
 * house's zone), and keeps its absolute instant; a manual run has no planned date. Its result is null until it
 * ends; `error` is a message for whoever operates the system, in English and without personal data.
 */
export const taskRuns = sqliteTable(
	"platform_task_runs",
	{
		id: integer().primaryKey({ autoIncrement: true }),
		task: text().notNull(),
		plannedDate: text("planned_date"),
		plannedAt: integer("planned_at").notNull(),
		startedAt: integer("started_at"),
		finishedAt: integer("finished_at"),
		result: text({ enum: ["ok", "failed", "cancelled", "skipped"] }),
		error: text(),
	},
	(table) => [
		uniqueIndex("platform_task_runs_planned").on(table.task, table.plannedDate),
		check(
			"platform_task_runs_result",
			sql`${table.result} IN ('ok', 'failed', 'cancelled', 'skipped')`,
		),
	],
);

/**
 * A job of the background engine: its kind, its lane, its state and attempts, the instant from which it may run
 * and, when it is a scheduled run, the run it belongs to. Claiming one moves it from `pending` to `running` in one
 * transaction. A job of the outbox (ADR 0029) keeps its data in `payload`, JSON its kind's schema checks when it is
 * claimed, and the log entry of the write that left it in `entry`, whose undo cancels it while pending; both are
 * null for a scheduled run. `outcome` is what a job that ended well says when "done" is not all, such as a notice
 * skipped and why.
 */
export const jobs = sqliteTable(
	"platform_jobs",
	{
		id: integer().primaryKey({ autoIncrement: true }),
		kind: text().notNull(),
		lane: text({ enum: ["short", "maintenance"] }).notNull(),
		state: text({
			enum: ["pending", "running", "done", "failed", "cancelled", "stuck"],
		}).notNull(),
		attempts: integer().notNull().default(0),
		runAt: integer("run_at").notNull(),
		taskRun: integer("task_run").references(() => taskRuns.id),
		createdAt: integer("created_at").notNull(),
		startedAt: integer("started_at"),
		finishedAt: integer("finished_at"),
		error: text(),
		payload: text(),
		entry: integer().references(() => actionLog.entry),
		outcome: text(),
	},
	(table) => [
		index("platform_jobs_due").on(table.lane, table.state, table.runAt),
		index("platform_jobs_task_run").on(table.taskRun),
		index("platform_jobs_entry").on(table.entry),
		check("platform_jobs_lane", sql`${table.lane} IN ('short', 'maintenance')`),
		check(
			"platform_jobs_state",
			sql`${table.state} IN ('pending', 'running', 'done', 'failed', 'cancelled', 'stuck')`,
		),
	],
);

// Backups (ADR 0026): the marks the backups leave, which the watcher of `/health` reads. platform/backups reads and
// writes them with prepared statements.

/**
 * The one row of the backups' marks (`id` is always 1): the last saved backup, with the instant its data was
 * captured and the id of its snapshot; the last failed attempt; the last retention and the last `check`, each with
 * its instant and result; and where the last restore came from. The cleanup never touches it, so it outlives the
 * purge of the runs and every restart. A column is null until its first mark.
 */
export const backupMarks = sqliteTable(
	"platform_backup_marks",
	{
		id: integer().primaryKey(),
		savedCapturedAt: integer("saved_captured_at"),
		savedSnapshot: text("saved_snapshot"),
		failedAt: integer("failed_at"),
		retentionAt: integer("retention_at"),
		retentionResult: text("retention_result", { enum: ["ok", "failed"] }),
		checkAt: integer("check_at"),
		checkResult: text("check_result", { enum: ["ok", "failed"] }),
		restoredSnapshot: text("restored_snapshot"),
		restoredCapturedAt: integer("restored_captured_at"),
		restoredAt: integer("restored_at"),
	},
	(table) => [
		check("platform_backup_marks_one_row", sql`${table.id} = 1`),
		check(
			"platform_backup_marks_retention_result",
			sql`${table.retentionResult} IN ('ok', 'failed')`,
		),
		check("platform_backup_marks_check_result", sql`${table.checkResult} IN ('ok', 'failed')`),
	],
);

// Files (ADR 0028): the contents in the store, the prepared files of an upload and the references that hang a
// content from a module's record. platform/files reads and writes them with prepared statements.

/** The six types a content may have, by the type it is served with (ADR 0028, «Qué promete el tipo»). */
export const FILE_TYPES = [
	"image/jpeg",
	"image/png",
	"image/webp",
	"image/heic",
	"application/pdf",
	"text/plain",
] as const;

/**
 * A file content: the bytes in the store, by their SHA-256, never rewritten, with their size, the type detected
 * from them and their state. `present` is available; `claimed` is being deleted by the cleanup, whose file may be
 * gone already.
 */
export const fileContents = sqliteTable(
	"platform_file_contents",
	{
		hash: text().primaryKey(),
		size: integer().notNull(),
		type: text({ enum: FILE_TYPES }).notNull(),
		state: text({ enum: ["present", "claimed"] }).notNull(),
		createdAt: integer("created_at").notNull(),
	},
	(table) => [
		check(
			"platform_file_contents_type",
			sql`${table.type} IN ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf', 'text/plain')`,
		),
		check("platform_file_contents_state", sql`${table.state} IN ('present', 'claimed')`),
	],
);

/**
 * A prepared file: what an upload gives back, by an opaque id that is not the hash. It is of the session and the
 * account that uploaded it, usable once and until it expires. Its session has no foreign key: a session that ends
 * leaves it useless at once, and the cleanup removes it.
 */
export const preparedFiles = sqliteTable(
	"platform_prepared_files",
	{
		id: text().primaryKey(),
		content: text()
			.notNull()
			.references(() => fileContents.hash),
		name: text().notNull(),
		session: text().notNull(),
		account: text().notNull(),
		expiresAt: integer("expires_at").notNull(),
		consumed: integer({ mode: "boolean" }).notNull().default(false),
	},
	(table) => [
		index("platform_prepared_files_session").on(table.session),
		index("platform_prepared_files_content").on(table.content),
	],
);

/**
 * A file reference: a content hung from a record of a module (its module, table and id), with the name its uploader
 * gave it, by an opaque id that is not the hash. A released one keeps the entry of the action log that released it,
 * whose undo may reattach it; a live one has none.
 */
export const fileReferences = sqliteTable(
	"platform_file_references",
	{
		id: text().primaryKey(),
		content: text()
			.notNull()
			.references(() => fileContents.hash),
		name: text().notNull(),
		module: text().notNull(),
		recordTable: text("record_table").notNull(),
		recordId: integer("record_id").notNull(),
		releasedBy: integer("released_by").references(() => actionLog.entry),
	},
	(table) => [
		index("platform_file_references_record").on(
			table.module,
			table.recordTable,
			table.recordId,
		),
		index("platform_file_references_content").on(table.content),
		index("platform_file_references_released_by").on(table.releasedBy),
	],
);

// Notices (ADR 0029): the subscriptions of the devices and the VAPID keys. platform/notifications reads and writes
// them with prepared statements.

/**
 * A subscription to notices: the push endpoint of a device's browser and its keys, registered from a session.
 * A device has at most one and an endpoint belongs to one only; both hang from their device and session, so ending
 * the session, however it ends, deletes its subscription.
 */
export const pushSubscriptions = sqliteTable(
	"platform_push_subscriptions",
	{
		id: text().primaryKey(),
		device: text()
			.notNull()
			.unique()
			.references(() => devices.id, { onDelete: "cascade" }),
		session: text()
			.notNull()
			.references(() => session.id, { onDelete: "cascade" }),
		endpoint: text().notNull().unique(),
		p256dh: text().notNull(),
		auth: text().notNull(),
		createdAt: integer("created_at").notNull(),
	},
	(table) => [index("platform_push_subscriptions_session").on(table.session)],
);

/**
 * The one pair of VAPID keys (`id` is always 1), each in base64url, generated the first time the platform opens.
 * Kept in the database, so it travels with the backup.
 */
export const pushKeys = sqliteTable(
	"platform_push_keys",
	{
		id: integer().primaryKey(),
		publicKey: text("public_key").notNull(),
		privateKey: text("private_key").notNull(),
		createdAt: integer("created_at").notNull(),
	},
	(table) => [check("platform_push_keys_one_row", sql`${table.id} = 1`)],
);

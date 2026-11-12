// The action log (ADR 0022): one entry per committed write, over the tables of platform/0001. Plain prepared
// statements of better-sqlite3, without a Drizzle schema. It writes inside the transaction platform/actions
// opens and never commits on its own.
import type { Actor, Inverse, TouchedRecord } from "@domus/module-sdk";
import type Database from "better-sqlite3";

/** What platform/actions logs for one write, once its handler ran and everything it returned is valid. */
export interface NewEntry {
	readonly module: string;
	/** The action's name inside its module. */
	readonly action: string;
	readonly actor: Actor;
	readonly key: string;
	readonly fingerprint: string;
	/** The platform clock's instant of the write, in milliseconds since the epoch. */
	readonly at: number;
	/** From this instant on, the content is expired. */
	readonly expiresAt: number;
	readonly input: unknown;
	readonly result: unknown;
	readonly inverse: Inverse | undefined;
	/** Records of `module`. */
	readonly touched: readonly TouchedRecord[];
}

/** One record a write touched, as the log keeps it: ids are text. */
export interface LoggedRecord {
	readonly module: string;
	readonly type: string;
	readonly id: string;
}

/** One entry as the log holds it: its annotation and its content, expired or not. */
export interface LogEntry {
	/** Its number in the log's own sequence, which defines "later". */
	readonly entry: number;
	/** The full name, `<module>.<action>`. */
	readonly action: string;
	readonly actor: Actor;
	readonly key: string;
	readonly fingerprint: string;
	readonly at: number;
	readonly expiresAt: number;
	/** The entry this one undid, when it is an undo. */
	readonly undoes: number | null;
	/** The entry that undid this one. */
	readonly undoneBy: number | null;
	readonly input: unknown;
	readonly result: unknown;
	readonly inverse: Inverse | null;
	readonly touched: readonly LoggedRecord[];
}

export interface Audit {
	/** Writes an entry and its touched records; returns its number. Only inside an open transaction. */
	record(entry: NewEntry): number;
	/** Every entry, in order, with its content even when expired. For the testing entry only. */
	entries(): readonly LogEntry[];
}

interface EntryRow {
	readonly entry: number;
	readonly module: string;
	readonly action: string;
	readonly account: string;
	readonly via: string | null;
	readonly key: string;
	readonly fingerprint: string;
	readonly at: number;
	readonly expires_at: number;
	readonly undoes: number | null;
	readonly undone_by: number | null;
	readonly input: string | null;
	readonly result: string | null;
	readonly inverse: string | null;
}

interface TouchedRow extends LoggedRecord {
	readonly entry: number;
}

/** The log on `connection`, whose schema already has platform/0001. */
export function createAudit(connection: Database.Database): Audit {
	const insertEntry = connection.prepare(
		`INSERT INTO platform_action_log
			(module, action, account, via, key, fingerprint, at, expires_at, input, result, inverse)
			VALUES (@module, @action, @account, @via, @key, @fingerprint, @at, @expiresAt, @input, @result, @inverse)`,
	);
	const insertTouched = connection.prepare(
		"INSERT INTO platform_action_log_touched (entry, module, type, id) VALUES (?, ?, ?, ?)",
	);
	const selectEntries = connection.prepare("SELECT * FROM platform_action_log ORDER BY entry");
	const selectTouched = connection.prepare(
		"SELECT entry, module, type, id FROM platform_action_log_touched ORDER BY entry, rowid",
	);

	return {
		record(entry) {
			if (!connection.inTransaction)
				throw new Error("the action log is written only inside the action's transaction");
			const number = Number(
				insertEntry.run({
					module: entry.module,
					action: entry.action,
					account: entry.actor.account,
					via: entry.actor.via ?? null,
					key: entry.key,
					fingerprint: entry.fingerprint,
					at: entry.at,
					expiresAt: entry.expiresAt,
					input: toJson(entry.input),
					result: toJson(entry.result),
					inverse: toJson(entry.inverse),
				}).lastInsertRowid,
			);
			const seen = new Set<string>();
			for (const { type, id } of entry.touched) {
				const record = JSON.stringify([type, String(id)]);
				if (seen.has(record)) continue;
				seen.add(record);
				insertTouched.run(number, entry.module, type, String(id));
			}
			return number;
		},

		entries() {
			const touched = selectTouched.all() as TouchedRow[];
			return (selectEntries.all() as EntryRow[]).map((row) => ({
				entry: row.entry,
				action: `${row.module}.${row.action}`,
				actor:
					row.via === null
						? { account: row.account }
						: { account: row.account, via: row.via },
				key: row.key,
				fingerprint: row.fingerprint,
				at: row.at,
				expiresAt: row.expires_at,
				undoes: row.undoes,
				undoneBy: row.undone_by,
				input: fromJson(row.input),
				result: fromJson(row.result),
				inverse: (fromJson(row.inverse) as Inverse | undefined) ?? null,
				touched: touched
					.filter((record) => record.entry === row.entry)
					.map(({ module, type, id }) => ({ module, type, id })),
			}));
		},
	};
}

/** SQL `NULL` stands for `undefined`, so a JSON `null` survives as itself. */
function toJson(value: unknown): string | null {
	return value === undefined ? null : JSON.stringify(value);
}

function fromJson(text: string | null): unknown {
	return text === null ? undefined : JSON.parse(text);
}

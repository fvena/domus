// The action log (ADR 0022): one entry per committed write, over the tables of platform/0001, without the result
// column platform/0002 drops (ADR 0023): an entry's content is its input and its inverse. Plain prepared
// statements of better-sqlite3; `schema.ts` declares the same tables only for drizzle-kit (ADR 0023). It writes inside the transaction platform/actions
// opens and never commits on its own.
import type { Actor, Inverse, TouchedRecord } from "@domus/module-sdk";
import type Database from "better-sqlite3";

/** What platform/actions logs for one write, once its handler ran and everything it returned is valid. */
export interface NewEntry {
	readonly module: string;
	/** The action's name inside its module. */
	readonly action: string;
	readonly actor: Actor;
	readonly idempotencyKey: string;
	readonly fingerprint: string;
	/** The platform clock's instant of the write, in milliseconds since the epoch. */
	readonly at: number;
	/** From this instant on, the content (input and inverse) is expired. */
	readonly expiresAt: number;
	readonly input: unknown;
	readonly inverse: Inverse | undefined;
	/** Records of `module`. */
	readonly touched: readonly TouchedRecord[];
	/** The entry this one undoes, when it is an undo. */
	readonly undoes?: number;
}

/** One record a write touched, as the log keeps it: ids are text. */
export interface LoggedRecord {
	readonly module: string;
	readonly type: string;
	readonly id: string;
}

/** One entry found by its number: its annotation and its content, expired or not. */
export interface NumberedEntry {
	/** Its number in the log's own sequence, which defines "later". */
	readonly entry: number;
	readonly module: string;
	/** The full name, `<module>.<action>`. */
	readonly action: string;
	readonly actor: Actor;
	readonly idempotencyKey: string;
	readonly fingerprint: string;
	readonly at: number;
	/** From this instant on, its content (input and inverse) is expired. */
	readonly expiresAt: number;
	/** The entry this one undid, when it is an undo. */
	readonly undoes: number | null;
	/** The entry that undid this one. */
	readonly undoneBy: number | null;
	readonly input: unknown;
	/** Null when its write cannot be undone. */
	readonly inverse: Inverse | null;
}

/** One entry as the testing entry reads the log: a numbered entry and the records it touched. */
export interface LogEntry extends Omit<NumberedEntry, "module"> {
	readonly touched: readonly LoggedRecord[];
}

/**
 * What reading the log answers of one entry: its annotation without its key or fingerprint, never its content
 * (ADR 0023).
 */
export interface Annotation {
	readonly entry: number;
	/** The full name, `<module>.<action>`. */
	readonly action: string;
	readonly actor: Actor;
	readonly at: number;
	readonly undoes: number | null;
	readonly undoneBy: number | null;
	readonly touched: readonly LoggedRecord[];
}

/** The annotation of an entry found by its key: what tells a repeated request from another one and acknowledges it. */
export interface KeyedEntry {
	readonly entry: number;
	readonly fingerprint: string;
}

export interface ActionLog {
	/** Writes an entry and its touched records; returns its number. Only inside an open transaction. */
	record(entry: NewEntry): number;
	/** The entry of `actor` (its account and `via`) under `idempotencyKey`, if there is one. */
	findByKey(actor: Actor, idempotencyKey: string): KeyedEntry | undefined;
	/** The entry numbered `entry`, if there is one. */
	find(entry: number): NumberedEntry | undefined;
	/** True when an entry after `entry` touched any record `entry` touched, even if that later one was undone. */
	touchedLater(entry: number): boolean;
	/** Links `entry` to the entry that undid it. Only inside an open transaction, and only once per entry. */
	markUndone(entry: number, by: number): void;
	/** The annotations of the entries `account` asked for, directly or through Kira, in order. */
	annotationsOf(account: string): readonly Annotation[];
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
	readonly inverse: string | null;
}

interface TouchedRow extends LoggedRecord {
	readonly entry: number;
}

/** The log on `connection`, whose schema already has platform/0001. */
export function createActionLog(connection: Database.Database): ActionLog {
	const insertEntry = connection.prepare(
		`INSERT INTO platform_action_log
			(module, action, account, via, key, fingerprint, at, expires_at, undoes, input, inverse)
			VALUES (@module, @action, @account, @via, @key, @fingerprint, @at, @expiresAt, @undoes, @input, @inverse)`,
	);
	const insertTouched = connection.prepare(
		"INSERT INTO platform_action_log_touched (entry, module, type, id) VALUES (?, ?, ?, ?)",
	);
	const selectByKey = connection.prepare(
		"SELECT entry, fingerprint FROM platform_action_log WHERE account = ? AND via IS ? AND key = ?",
	);
	const selectByNumber = connection.prepare("SELECT * FROM platform_action_log WHERE entry = ?");
	const selectTouchedLater = connection.prepare(
		`SELECT 1 FROM platform_action_log_touched AS mine
			JOIN platform_action_log_touched AS later
				ON later.module = mine.module AND later.type = mine.type AND later.id = mine.id AND later.entry > mine.entry
			WHERE mine.entry = ? LIMIT 1`,
	);
	const updateUndoneBy = connection.prepare(
		"UPDATE platform_action_log SET undone_by = ? WHERE entry = ? AND undone_by IS NULL",
	);
	const selectEntries = connection.prepare("SELECT * FROM platform_action_log ORDER BY entry");
	const selectOwnEntries = connection.prepare(
		"SELECT entry, module, action, account, via, at, undoes, undone_by FROM platform_action_log WHERE account = ? ORDER BY entry",
	);
	const selectOwnTouched = connection.prepare(
		`SELECT touched.entry, touched.module, touched.type, touched.id FROM platform_action_log_touched AS touched
			JOIN platform_action_log AS log ON log.entry = touched.entry
			WHERE log.account = ? ORDER BY touched.entry, touched.rowid`,
	);
	const selectTouched = connection.prepare(
		"SELECT entry, module, type, id FROM platform_action_log_touched ORDER BY entry, rowid",
	);

	/** The log never opens or commits a transaction: it writes only inside the action's. */
	function requireTransaction(): void {
		if (!connection.inTransaction)
			throw new Error("the action log is written only inside the action's transaction");
	}

	return {
		record(entry) {
			requireTransaction();
			const number = Number(
				insertEntry.run({
					module: entry.module,
					action: entry.action,
					account: entry.actor.account,
					via: entry.actor.via ?? null,
					key: entry.idempotencyKey,
					fingerprint: entry.fingerprint,
					at: entry.at,
					expiresAt: entry.expiresAt,
					undoes: entry.undoes ?? null,
					input: toJson(entry.input),
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

		findByKey(actor, idempotencyKey) {
			const row = selectByKey.get(actor.account, actor.via ?? null, idempotencyKey) as
				| Pick<EntryRow, "entry" | "fingerprint">
				| undefined;
			return row && { entry: row.entry, fingerprint: row.fingerprint };
		},

		find(entry) {
			const row = selectByNumber.get(entry) as EntryRow | undefined;
			return row && entryOf(row);
		},

		touchedLater(entry) {
			return selectTouchedLater.get(entry) !== undefined;
		},

		markUndone(entry, by) {
			requireTransaction();
			if (updateUndoneBy.run(by, entry).changes !== 1)
				throw new Error(`entry ${entry} is missing or already undone`);
		},

		annotationsOf(account) {
			const touched = recordsByEntry(selectOwnTouched.all(account) as TouchedRow[]);
			return (selectOwnEntries.all(account) as EntryRow[]).map((row) => ({
				entry: row.entry,
				action: `${row.module}.${row.action}`,
				actor: actorOf(row),
				at: row.at,
				undoes: row.undoes,
				undoneBy: row.undone_by,
				touched: touched.get(row.entry) ?? [],
			}));
		},

		entries() {
			const touched = selectTouched.all() as TouchedRow[];
			return (selectEntries.all() as EntryRow[]).map((row) => {
				const { module: _module, ...entry } = entryOf(row);
				return {
					...entry,
					touched: touched
						.filter((record) => record.entry === row.entry)
						.map(({ module, type, id }) => ({ module, type, id })),
				};
			});
		},
	};
}

/** One row of `platform_action_log` as an entry: its content back from JSON, SQL `NULL` as `undefined`. */
function entryOf(row: EntryRow): NumberedEntry {
	return {
		entry: row.entry,
		module: row.module,
		action: `${row.module}.${row.action}`,
		actor: actorOf(row),
		idempotencyKey: row.key,
		fingerprint: row.fingerprint,
		at: row.at,
		expiresAt: row.expires_at,
		undoes: row.undoes,
		undoneBy: row.undone_by,
		input: fromJson(row.input),
		inverse: (fromJson(row.inverse) as Inverse | undefined) ?? null,
	};
}

function actorOf(row: Pick<EntryRow, "account" | "via">): Actor {
	return row.via === null ? { account: row.account } : { account: row.account, via: row.via };
}

/** The touched records of each entry, in the order they were logged. */
function recordsByEntry(rows: readonly TouchedRow[]): ReadonlyMap<number, LoggedRecord[]> {
	const records = new Map<number, LoggedRecord[]>();
	for (const { entry, module, type, id } of rows) {
		const list = records.get(entry) ?? [];
		list.push({ module, type, id });
		records.set(entry, list);
	}
	return records;
}

/** SQL `NULL` stands for `undefined`, so a JSON `null` survives as itself. */
function toJson(value: unknown): string | null {
	return value === undefined ? null : JSON.stringify(value);
}

function fromJson(text: string | null): unknown {
	return text === null ? undefined : JSON.parse(text);
}

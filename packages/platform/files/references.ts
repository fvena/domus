// The references of files (ADR 0028, spec of phase 1d3, «`ctx.files` y `fileRef()`» and «Deshacer con referencias
// soltadas»): what a handler's `ctx.files` does to the records of its own module, inside the transaction of its
// write, and what the path of the actions needs of them around it. Only rows: the store on disk is not touched,
// so it works with the database in memory too. A reference points at its owner record, by its module, the SQL
// name of its table and its id; a released one keeps the entry of the action log that released it, whose undo
// alone may reattach it.
import type { ModuleFiles, OwnedTable, RecordOf, TouchedRecord } from "@domus/module-sdk";
import { ownedTableOf } from "@domus/module-sdk";
import type { FileRef } from "@domus/module-sdk/contracts";
import { ORPCError } from "@orpc/server";
import type Database from "better-sqlite3";
import { and, eq, getTableName, type SQL } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

import { conflict } from "../actions/failures";
import { type AccessView, visibleTo } from "../authorization";
import type { OwnedRecordChange } from "../authorization/invalidations";
import type { Ownership } from "../authorization/visibility";
import { editableTo, type RecordArea } from "../authorization/writes";
import { randomId } from "../identity/accounts";
import { sessionLives } from "../identity/sessions";
import type { FileDescription } from "./type";

/**
 * What `ctx.files` refuses to a handler: "not found", "forbidden" or a conflict with its reason. The one error of
 * the platform's own that leaves a handler as it is, besides `forbidden()`.
 */
export class FilesRefusal extends ORPCError<string, unknown> {}

/** What a write's run of a handler collects of its files, for the path of the actions to finish around it. */
export interface WriteRun {
	/** Whether the write can be undone: a detachment then releases the reference instead of deleting it. */
	readonly undoable: boolean;
	/** The number of the entry this write undoes, when it runs as an undo: the one whose releases it may reattach. */
	readonly undoes: number | undefined;
	/**
	 * The records `ctx.files` changed, as the handler would declare them touched: one per change, which the path of
	 * the actions merges with the handler's own, each record once.
	 */
	readonly touched: TouchedRecord[];
	/**
	 * The records `ctx.files` changed, as the live channel tells of them (ADR 0029): one per change, each with its
	 * owner and visibility when its files changed as both its states, since changing files leaves its row alone.
	 * The path of the actions adds those the capture did not see, each record once.
	 */
	readonly changed: OwnedRecordChange[];
	/** The references detached by an undoable write, to link to its entry once the log has its number. */
	readonly released: Set<string>;
}

/** What one run of a handler gives its `ctx.files`. */
export interface FilesOfRun {
	readonly module: string;
	/** The module's own database, to find the owner record with its visibility. */
	readonly db: BetterSQLite3Database<Record<string, unknown>>;
	/** The area of one of the module's owned tables; any other table throws. */
	readonly areaOf: (table: OwnedTable) => RecordArea;
	readonly account: string;
	/** The session the request came with: a prepared file is only of the session that uploaded it. */
	readonly session: string | undefined;
	readonly now: number;
	/** Present only for a write: a read may only list files. */
	readonly write: WriteRun | undefined;
}

/** A live reference as a download needs it: its content's hash and what its answer says of it. */
export interface LiveReference extends FileDescription {
	readonly hash: string;
}

export interface References {
	/** The `ctx.files` of one run of a handler. */
	forRun(run: FilesOfRun): ModuleFiles;
	/** Links the references an undoable write released to its entry, in the transaction of that write. */
	linkReleased(released: Iterable<string>, entry: number): void;
	/** A live reference of a record of `module`, or `undefined`. */
	live(module: string, id: string): LiveReference | undefined;
}

interface ReferenceRow extends FileDescription {
	readonly id: string;
	readonly releasedBy: number | null;
	/** 1 while its content is present: 0 once the cleanup claimed it to delete it. */
	readonly present: number;
}

interface PreparedRow extends FileDescription {
	/** The hash of its content. */
	readonly hash: string;
	readonly session: string;
	readonly expiresAt: number;
	readonly consumed: number;
	/** 1 while its content is present: 0 once the cleanup claimed it to delete it. */
	readonly present: number;
}

const REFERENCE = `SELECT r.id, r.name, c.type, c.size, r.released_by AS releasedBy,
		c.state = 'present' AS present
	FROM platform_file_references r JOIN platform_file_contents c ON c.hash = r.content`;

export function createReferences(connection: Database.Database, view: AccessView): References {
	const lives = sessionLives(connection);
	const ofRecord = connection.prepare<[string, string, number], ReferenceRow>(
		`${REFERENCE} WHERE r.module = ? AND r.record_table = ? AND r.record_id = ? AND r.released_by IS NULL
		ORDER BY r.rowid`,
	);
	const oneOfRecord = connection.prepare<[string, string, string, number], ReferenceRow>(
		`${REFERENCE} WHERE r.id = ? AND r.module = ? AND r.record_table = ? AND r.record_id = ?`,
	);
	const preparedFile = connection.prepare<[string], PreparedRow>(
		`SELECT p.content AS hash, p.name, p.session, p.expires_at AS expiresAt, p.consumed, c.type, c.size,
			c.state = 'present' AS present
		FROM platform_prepared_files p JOIN platform_file_contents c ON c.hash = p.content WHERE p.id = ?`,
	);
	const consume = connection.prepare<[string]>(
		"UPDATE platform_prepared_files SET consumed = 1 WHERE id = ?",
	);
	const insertReference = connection.prepare<[string, string, string, string, string, number]>(
		`INSERT INTO platform_file_references (id, content, name, module, record_table, record_id)
		VALUES (?, ?, ?, ?, ?, ?)`,
	);
	const release = connection.prepare<[number, string]>(
		"UPDATE platform_file_references SET released_by = ? WHERE id = ?",
	);
	const reattachReference = connection.prepare<[string]>(
		"UPDATE platform_file_references SET released_by = NULL WHERE id = ?",
	);
	const remove = connection.prepare<[string]>(
		"DELETE FROM platform_file_references WHERE id = ?",
	);
	const liveOfModule = connection.prepare<[string, string], LiveReference>(
		`SELECT r.content AS hash, r.name, c.type, c.size
		FROM platform_file_references r JOIN platform_file_contents c ON c.hash = r.content
		WHERE r.id = ? AND r.module = ? AND r.released_by IS NULL`,
	);

	return {
		forRun: ({ module, db, areaOf, account, session, now, write }) => {
			/** Whether the record of `table` with `id` exists and passes `predicate`. */
			const recordPasses = (table: OwnedTable, id: number, predicate: SQL) =>
				db
					.select({ id: table.id })
					.from(table)
					.where(and(eq(table.id, id), predicate))
					.get() !== undefined;

			/** The owner and visibility of the record of `table` with `id`, which exists. */
			const ownershipOf = (table: OwnedTable, id: number): Ownership => {
				const found = db
					.select({ owner: table.owner, visibility: table.visibility })
					.from(table)
					.where(eq(table.id, id))
					.get() as Ownership | undefined;
				if (!found) throw new Error("the record is gone");
				return found;
			};

			/**
			 * Opens a change of a record's files, which must exist, be seen and be editable, as for an edit: the write,
			 * the SQL name of the record's table, and `touch`, which notes the record as touched with the same type
			 * and id as a change of a column once the change is made, and as changed with its owner and visibility. A
			 * read, which may not change anything, and a table that is not one of the module's owned tables are the
			 * module's mistakes.
			 */
			const changeFilesOf = ({
				table,
				id,
			}: RecordOf): { run: WriteRun; tableName: string; touch: () => void } => {
				if (!write) throw new Error("only a write may change the files of a record");
				const area = areaOf(table);
				const type = ownedTableOf(table)?.type;
				if (type === undefined) throw new Error("not an owned table of this module");
				if (!recordPasses(table, id, visibleTo(table, account)))
					throw new FilesRefusal("NOT_FOUND");
				if (!recordPasses(table, id, editableTo(table, account, area, view)))
					throw new FilesRefusal("FORBIDDEN");
				return {
					run: write,
					tableName: getTableName(table),
					touch: () => {
						write.touched.push({ type, id });
						const state = ownershipOf(table, id);
						write.changed.push({
							module,
							type,
							id,
							area: area.id,
							before: state,
							after: state,
						});
					},
				};
			};

			return {
				of: (table, id) => {
					areaOf(table);
					if (!recordPasses(table, id, visibleTo(table, account))) return [];
					return ofRecord
						.all(module, getTableName(table), id)
						.filter((row) => !write?.released.has(row.id))
						.map(fileRefOf);
				},
				attach: (prepared, record) => {
					const { tableName, touch } = changeFilesOf(record);
					const found = preparedFile.get(prepared);
					// A prepared file is the session's that uploaded it, and only while that session lives; nothing
					// is attached from a content the cleanup is deleting.
					if (
						!found ||
						found.present === 0 ||
						session === undefined ||
						found.session !== session ||
						!lives(account, session, now)
					)
						throw new FilesRefusal("NOT_FOUND");
					if (found.consumed !== 0) throw refusalOf(conflict("prepared-file-consumed"));
					if (now >= found.expiresAt) throw refusalOf(conflict("prepared-file-expired"));
					consume.run(prepared);
					const id = randomId();
					insertReference.run(id, found.hash, found.name, module, tableName, record.id);
					touch();
					return { id, name: found.name, type: found.type, size: found.size };
				},
				detach: (file, record) => {
					const { run, tableName, touch } = changeFilesOf(record);
					const found = oneOfRecord.get(file, module, tableName, record.id);
					if (!found || found.releasedBy !== null || run.released.has(file))
						throw new FilesRefusal("NOT_FOUND");
					if (run.undoable) run.released.add(file);
					else remove.run(file);
					touch();
					return fileRefOf(found);
				},
				reattach: (file, record) => {
					const { run, tableName, touch } = changeFilesOf(record);
					const found = oneOfRecord.get(file, module, tableName, record.id);
					// Only the undo of the entry that released it reattaches it.
					if (
						!found ||
						found.present === 0 ||
						found.releasedBy === null ||
						found.releasedBy !== run.undoes
					)
						throw new FilesRefusal("NOT_FOUND");
					reattachReference.run(file);
					touch();
					return fileRefOf(found);
				},
			};
		},
		linkReleased: (released, entry) => {
			for (const file of released) release.run(entry, file);
		},
		live: (module, id) => liveOfModule.get(id, module),
	};
}

function fileRefOf({ id, name, type, size }: ReferenceRow): FileRef {
	return { id, name, type, size };
}

/** A conflict of the platform as a refusal of `ctx.files`, with the same code and data. */
function refusalOf(error: ORPCError<string, unknown>): FilesRefusal {
	return new FilesRefusal(error.code, { data: error.data });
}

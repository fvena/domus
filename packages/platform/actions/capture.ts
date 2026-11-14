// The write capture (ADR 0023): temporary triggers on every owned table note each row transition of the one
// connection in a temporary table, which a write reads before it commits. Installed once the migrations ran,
// before any action: a temporary trigger stops a migration from dropping a column it reads. `recursive_triggers`
// is on, so the row a REPLACE deletes is noted too. What it does not cover is rejected: a handler that changes
// the schema (dropping a trigger or a table among others), turns `recursive_triggers` off or erases rows of the
// capture. Tables without an owner are not captured: they rely on the records their handlers declare.
import { type ModuleDefinition, recordTablesOf, type Visibility } from "@domus/module-sdk";
import type Database from "better-sqlite3";

import type { AreaPolicy } from "../authorization";
import type { OwnedRecordChange, RecordChange } from "../authorization/invalidations";
import type { RecordArea, RowTransition } from "../authorization/writes";

/** An owned table as the capture knows it: its module, its record type and its area. */
export interface CapturedTable {
	readonly module: string;
	readonly type: string;
	readonly area: RecordArea;
}

/** One transition the capture saw, with the table it happened in. */
export interface CapturedTransition extends RowTransition {
	readonly table: CapturedTable;
}

export interface Capture {
	/**
	 * Runs `operation`, a handler, on an empty capture and returns its value with the transitions it made, in
	 * order. Throws `UncoveredWrite` when the handler wrote in a way the capture does not cover.
	 */
	watch<T>(operation: () => T): {
		readonly value: T;
		readonly transitions: readonly CapturedTransition[];
	};
	/** Empties the capture, so a committed write leaves nothing behind. */
	clear(): void;
}

/** A handler wrote in a way the capture does not cover: the write must not commit. */
export class UncoveredWrite extends Error {}

const CAPTURE = "platform_capture";

interface CaptureRow {
	readonly seq: number;
	readonly tbl: string;
	readonly op: RowTransition["operation"];
	readonly old_id: number | null;
	readonly new_id: number | null;
	readonly old_owner: string | null;
	readonly new_owner: string | null;
	// The `CHECK` of every owned table keeps it one of the visibilities.
	readonly old_visibility: Visibility | null;
	readonly new_visibility: Visibility | null;
}

/** Creates the capture table and the triggers of every owned table of `modules`, on `connection`. */
export function installCapture(
	connection: Database.Database,
	modules: readonly ModuleDefinition[],
	areas: ReadonlyMap<string, AreaPolicy>,
): Capture {
	const tables = new Map<string, CapturedTable>();
	for (const module of modules)
		for (const { kind, name, type, area } of recordTablesOf(module)) {
			const policy = areas.get(area);
			if (kind !== "owned" || !policy) continue;
			tables.set(name, { module: module.id, type, area: { id: area, policy } });
		}

	connection.pragma("recursive_triggers = ON");
	connection.exec(
		`CREATE TEMP TABLE ${CAPTURE} (seq INTEGER PRIMARY KEY AUTOINCREMENT, tbl TEXT NOT NULL, op TEXT NOT NULL, old_id, new_id, old_owner, new_owner, old_visibility, new_visibility)`,
	);
	for (const name of tables.keys()) {
		const table = quoted(name);
		const literal = `'${name.replace(/'/g, "''")}'`;
		const row = (op: string, old: boolean, now: boolean) =>
			`INSERT INTO temp.${CAPTURE} (tbl, op, old_id, new_id, old_owner, new_owner, old_visibility, new_visibility) VALUES (${literal}, '${op}', ${old ? "OLD.id" : "NULL"}, ${now ? "NEW.id" : "NULL"}, ${old ? "OLD.owner" : "NULL"}, ${now ? "NEW.owner" : "NULL"}, ${old ? "OLD.visibility" : "NULL"}, ${now ? "NEW.visibility" : "NULL"});`;
		connection.exec(
			[
				`CREATE TEMP TRIGGER ${quoted(`${CAPTURE}_${name}_insert`)} AFTER INSERT ON main.${table} BEGIN ${row("insert", false, true)} END;`,
				`CREATE TEMP TRIGGER ${quoted(`${CAPTURE}_${name}_update`)} AFTER UPDATE ON main.${table} BEGIN ${row("update", true, true)} END;`,
				`CREATE TEMP TRIGGER ${quoted(`${CAPTURE}_${name}_delete`)} AFTER DELETE ON main.${table} BEGIN ${row("delete", true, false)} END;`,
			].join("\n"),
		);
	}

	const empty = connection.prepare(`DELETE FROM temp.${CAPTURE}`);
	const rows = connection.prepare<[], CaptureRow>(`SELECT * FROM temp.${CAPTURE} ORDER BY seq`);
	// The last number the capture handed out: a row erased since leaves a gap that the count shows.
	const last = connection
		.prepare<[], number>(`SELECT seq FROM temp.sqlite_sequence WHERE name = '${CAPTURE}'`)
		.pluck();
	const schemaVersions = () =>
		`${String(connection.pragma("main.schema_version", { simple: true }))}:${String(connection.pragma("temp.schema_version", { simple: true }))}`;

	return {
		clear: () => empty.run(),
		watch(operation) {
			empty.run();
			const start = last.get() ?? 0;
			const schema = schemaVersions();
			let value;
			let recursive: unknown;
			try {
				value = operation();
			} finally {
				// A connection setting, which no rollback undoes: put it back before anything else runs.
				recursive = connection.pragma("recursive_triggers", { simple: true });
				if (recursive !== 1) connection.pragma("recursive_triggers = ON");
			}
			if (recursive !== 1) throw new UncoveredWrite("recursive_triggers was turned off");
			if (schemaVersions() !== schema) throw new UncoveredWrite("the schema changed");
			const seen = rows.all();
			if (seen.length !== (last.get() ?? 0) - start)
				throw new UncoveredWrite("rows of the capture were erased");

			const transitions = seen.map((row): CapturedTransition => {
				const table = tables.get(row.tbl);
				if (!table) throw new UncoveredWrite(`no owned table "${row.tbl}"`);
				return {
					table,
					operation: row.op,
					oldId: row.old_id,
					newId: row.new_id,
					oldOwner: row.old_owner,
					newOwner: row.new_owner,
					oldVisibility: row.old_visibility,
					newVisibility: row.new_visibility,
				};
			});
			return { value, transitions };
		},
	};
}

/**
 * What a write remembers of the records it changed (ADR 0029): per record, in the order first seen, its area, its
 * first state before the write and its last after it. The states in between never count, so a note made public
 * and private again in one write was never public. `files` are the records whose files the write changed (ADR
 * 0028), with their state then: each one the capture did not see follows, once, as it was.
 */
export function changesOf(
	transitions: readonly CapturedTransition[],
	files: readonly OwnedRecordChange[] = [],
): RecordChange[] {
	const changes = new Map<string, RecordChange>();
	for (const transition of transitions) {
		const { table, operation } = transition;
		const id = operation === "insert" ? transition.newId : transition.oldId;
		if (id === null) continue;
		const after =
			operation === "delete"
				? null
				: { owner: transition.newOwner, visibility: transition.newVisibility };
		const key = JSON.stringify([table.module, table.type, id]);
		const first = changes.get(key);
		changes.set(
			key,
			first === undefined
				? {
						module: table.module,
						type: table.type,
						id,
						area: table.area.id,
						before:
							operation === "insert"
								? null
								: {
										owner: transition.oldOwner,
										visibility: transition.oldVisibility,
									},
						after,
					}
				: { ...first, after },
		);
	}
	for (const change of files) {
		const key = JSON.stringify([change.module, change.type, change.id]);
		if (!changes.has(key)) changes.set(key, change);
	}
	return [...changes.values()];
}

/** `identifier` as an SQL identifier between double quotes, for a name that comes from a module's code. */
export function quoted(identifier: string): string {
	return `"${identifier.replace(/"/g, '""')}"`;
}

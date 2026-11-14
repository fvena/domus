// The records a notice can be about (ADR 0029, «A quién va un aviso»): those of the modules' owned tables and area
// tables, found by module and record type. A notice gathers a record's facts when it is shared out and again before
// each send.
import { areaTableOf, type ModuleDefinition, ownedTableOf } from "@domus/module-sdk";
import type Database from "better-sqlite3";
import { getTableName } from "drizzle-orm";

import type { NoticeRecord } from "../authorization/notices";
import { PermanentJobError } from "../background";

/** The code of a notice about a type that no owned or area table of its module declares, such as a module that left. */
export const UNKNOWN_RECORD = "UNKNOWN_RECORD";

/** Which record a notice is about: its module, its type and its id. */
export interface NoticeAbout {
	readonly module: string;
	readonly type: string;
	readonly id: number;
}

/**
 * Finds the facts of a record a notice is about: `null` once it no longer exists. A type that no owned or area
 * table of its module declares fails the job for good with {@link UNKNOWN_RECORD}.
 */
export type RecordFacts = (about: NoticeAbout) => NoticeRecord | null;

/**
 * The facts of the records of `modules`' owned tables and area tables, read on `connection`: an area table's record
 * has only its area.
 */
export function recordFacts(
	connection: Database.Database,
	modules: readonly ModuleDefinition[],
): RecordFacts {
	const tables = new Map<
		string,
		{ readonly area: string; readonly select: Database.Statement }
	>();
	for (const module of modules)
		for (const value of Object.values(module.schema)) {
			const owned = ownedTableOf(value);
			const info = owned ?? areaTableOf(value);
			if (!info) continue;
			// The name comes from the module's code, never from data.
			const name = getTableName(value as Parameters<typeof getTableName>[0]);
			const columns = owned ? "owner, visibility" : "1 AS found";
			tables.set(key(module.id, info.type), {
				area: info.area,
				select: connection.prepare(`SELECT ${columns} FROM "${name}" WHERE id = ?`),
			});
		}
	return (about) => {
		const table = tables.get(key(about.module, about.type));
		if (!table)
			throw new PermanentJobError(
				`no owned or area table of "${about.module}" has the record type "${about.type}"`,
				{ code: UNKNOWN_RECORD },
			);
		const found = table.select.get(about.id) as
			| { readonly owner: string; readonly visibility: string }
			| { readonly found: 1 }
			| undefined;
		if (!found) return null;
		return "owner" in found ? { area: table.area, ...found } : { area: table.area };
	};
}

function key(module: string, type: string): string {
	return `${module}\0${type}`;
}

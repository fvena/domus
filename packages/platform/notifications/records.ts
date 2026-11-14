// The records a notice can be about (ADR 0029, «A quién va un aviso»): those of the modules' owned tables, found by
// module and record type. A notice gathers a record's facts when it is shared out and again before each send.
import { type ModuleDefinition, ownedTableOf } from "@domus/module-sdk";
import type Database from "better-sqlite3";
import { getTableName } from "drizzle-orm";

import type { NoticeRecord } from "../authorization/notices";
import { PermanentJobError } from "../background";

/** The code of a notice about a type that no owned table of its module declares, such as a module that left. */
export const UNKNOWN_RECORD = "UNKNOWN_RECORD";

/** Which record a notice is about: its module, its type and its id. */
export interface NoticeAbout {
	readonly module: string;
	readonly type: string;
	readonly id: number;
}

/**
 * Finds the facts of a record a notice is about: `null` once it no longer exists. A type that no owned table of
 * its module declares fails the job for good with {@link UNKNOWN_RECORD}.
 */
export type RecordFacts = (about: NoticeAbout) => NoticeRecord | null;

/** The facts of the records of `modules`' owned tables, read on `connection`. */
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
			const info = ownedTableOf(value);
			if (!info) continue;
			// The name comes from the module's code, never from data.
			const name = getTableName(value as Parameters<typeof getTableName>[0]);
			tables.set(key(module.id, info.type), {
				area: info.area,
				select: connection.prepare(`SELECT owner, visibility FROM "${name}" WHERE id = ?`),
			});
		}
	return (about) => {
		const table = tables.get(key(about.module, about.type));
		if (!table)
			throw new PermanentJobError(
				`no owned table of "${about.module}" has the record type "${about.type}"`,
				{ code: UNKNOWN_RECORD },
			);
		const found = table.select.get(about.id) as
			| { readonly owner: string; readonly visibility: string }
			| undefined;
		return found ? { area: table.area, ...found } : null;
	};
}

function key(module: string, type: string): string {
	return `${module}\0${type}`;
}

// The Drizzle client of one module, typed with its schema (ADR 0021). In phase 1a only test-utils uses it,
// for dbFor in storage tests; a module's own code gets its database with the actions (phase 1b).
import type { ModuleDefinition, ModuleSchema } from "@domus/module-sdk";
import { type BetterSQLite3Database, drizzle } from "drizzle-orm/better-sqlite3";

import { connectionOf, modulesOf, type Platform } from "../platform";

export type ModuleDatabase<TSchema extends ModuleSchema> = BetterSQLite3Database<TSchema>;

/** A client over the platform's connection for `module`, which must be one of the modules it received. */
export function moduleDatabase<TSchema extends ModuleSchema>(
	platform: Platform,
	module: ModuleDefinition<TSchema>,
): ModuleDatabase<TSchema> {
	if (!modulesOf(platform).includes(module))
		throw new Error(`module "${module.id}" is not one of this platform's modules`);
	return drizzle({ client: connectionOf(platform), schema: module.schema });
}

// The shape of a module in phase 1a (ADR 0021): its id, its tables and their migrations. Each later subphase
// adds its piece when it arrives; nothing is reserved ahead.
import { getTableName, is } from "drizzle-orm";
import { SQLiteTable } from "drizzle-orm/sqlite-core";

/** One migration as data, the shape `pnpm db:generate` writes into `server/migrations.ts`. */
export interface ModuleMigration {
	/** The name drizzle-kit gives it in `_journal.json`, such as `0000_initial`. */
	readonly tag: string;
	/** Its place in the module's journal, from 0. The order of the history. */
	readonly position: number;
	/** The hash of its SQL file, as `readMigrationFiles` of `drizzle-orm/migrator` gives it. */
	readonly hash: string;
	readonly statements: readonly string[];
}

/** What a module's exports may hold: its tables, made with `moduleTables`, and anything else Drizzle reads. */
export type ModuleSchema = Readonly<Record<string, unknown>>;

export interface ModuleDefinition<TSchema extends ModuleSchema = ModuleSchema> {
	/** `[a-z][a-z0-9]*`, the same as the module's folder; also the prefix of its tables. */
	readonly id: string;
	/** Kept out of the module list of `apps/api`: tests import it and hand it to test-utils. */
	readonly testOnly?: boolean;
	readonly schema: TSchema;
	readonly migrations: readonly ModuleMigration[];
}

export function defineModule<TSchema extends ModuleSchema>(
	definition: ModuleDefinition<TSchema>,
): ModuleDefinition<TSchema> {
	return definition;
}

const MODULE_ID = /^[a-z][a-z0-9]*$/;
/** The prefix of the platform's tables (`platform_migrations`): no module may take it. */
const RESERVED_ID = "platform";

/**
 * Checks a list of module definitions before they are registered: by createPlatform and by the module list
 * generator. Throws on the first problem, naming the module.
 */
export function checkModules(modules: readonly ModuleDefinition[]): void {
	const seen = new Set<string>();
	for (const module of modules) {
		if (seen.has(module.id)) throw new Error(`module "${module.id}": two modules have this id`);
		seen.add(module.id);
		if (!MODULE_ID.test(module.id))
			throw new Error(`module "${module.id}": the id must match [a-z][a-z0-9]*`);
		if (module.id === RESERVED_ID)
			throw new Error(
				`module "${module.id}": the id is reserved for the platform's own tables`,
			);

		const prefix = `${module.id}_`;
		for (const value of Object.values(module.schema)) {
			if (!is(value, SQLiteTable)) continue;
			const name = getTableName(value);
			if (!name.startsWith(prefix))
				throw new Error(
					`module "${module.id}": table "${name}" must start with "${prefix}"`,
				);
		}
	}
}

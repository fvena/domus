// The shape of a module (ADR 0021, ADR 0022): its id, its tables and their migrations, and its actions: the
// contract and its implementation. Each later subphase adds its piece when it arrives; nothing is reserved ahead.
import { getTableName, is } from "drizzle-orm";
import { SQLiteTable } from "drizzle-orm/sqlite-core";

import type { ModuleActions, ModuleSchema } from "./actions";
import type { ModuleContract } from "./contracts";

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

export interface ModuleDefinition<
	TSchema extends ModuleSchema = ModuleSchema,
	TContract extends ModuleContract = ModuleContract,
	TId extends string = string,
> {
	/** `[a-z][a-z0-9]*`, the same as the module's folder; also the prefix of its tables. */
	readonly id: TId;
	/** Kept out of the module list of `apps/api`: tests import it and hand it to test-utils. */
	readonly testOnly?: boolean;
	readonly schema: TSchema;
	readonly migrations: readonly ModuleMigration[];
	/** The actions it offers, from its `contracts/`. A module without actions leaves it out. */
	readonly contract?: TContract;
	/** One handler per action of `contract`, by the same names. */
	readonly actions?: ModuleActions<TContract, TSchema>;
}

export function defineModule<
	TId extends string,
	TSchema extends ModuleSchema,
	TContract extends ModuleContract = Record<never, never>,
>(
	definition: ModuleDefinition<TSchema, TContract, TId> & {
		readonly actions?: ModuleActions<NoInfer<TContract>, NoInfer<TSchema>>;
	},
): ModuleDefinition<TSchema, TContract, TId> {
	return definition;
}

const MODULE_ID = /^[a-z][a-z0-9]*$/;
/** The platform's own id: the prefix of its tables and the owner of its rows in `platform_migrations`. No module may take it. */
export const PLATFORM_ID = "platform";

/**
 * Checks a list of module definitions before they are registered: by createPlatform and by the module list
 * generator. Throws on the first problem, naming the module, and the action when the problem is one.
 */
export function checkModules(modules: readonly ModuleDefinition[]): void {
	const seen = new Set<string>();
	const actionNames = new Set<string>();
	for (const module of modules) {
		if (!MODULE_ID.test(module.id))
			throw new Error(`module "${module.id}": the id must match [a-z][a-z0-9]*`);
		if (module.id === PLATFORM_ID)
			throw new Error(
				`module "${module.id}": the id is reserved for the platform's own tables`,
			);
		// Before the repeated id: two definitions of one module that declare the same action are named by
		// that action.
		checkActions(module, actionNames);
		if (seen.has(module.id)) throw new Error(`module "${module.id}": two modules have this id`);
		seen.add(module.id);

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

/** Every action of the contract has a handler, every handler has a contract, and no full name repeats. */
function checkActions(module: ModuleDefinition, actionNames: Set<string>): void {
	const declared = Object.keys(module.contract ?? {});
	const implemented = Object.keys(module.actions ?? {});
	for (const name of declared) {
		const fullName = `${module.id}.${name}`;
		if (actionNames.has(fullName))
			throw new Error(`module "${module.id}": action "${fullName}" is declared twice`);
		actionNames.add(fullName);
		if (!implemented.includes(name))
			throw new Error(`module "${module.id}": action "${fullName}" has no implementation`);
	}
	for (const name of implemented)
		if (!declared.includes(name))
			throw new Error(`module "${module.id}": action "${module.id}.${name}" has no contract`);
}

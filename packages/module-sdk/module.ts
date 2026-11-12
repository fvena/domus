// The shape of a module (ADR 0021, ADR 0022, ADR 0023): its id, its areas, its tables and their migrations, and
// its actions: the contract and its implementation. Each later subphase adds its piece when it arrives; nothing
// is reserved ahead.
import { getTableName, is } from "drizzle-orm";
import { SQLiteTable } from "drizzle-orm/sqlite-core";

import type { ModuleActions, ModuleSchema } from "./actions";
import type { ActionMeta, ModuleContract } from "./contracts";

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

/**
 * What an area declares about itself. `alwaysPrivate`: nothing of it is ever public, and the device account
 * gets no permission in it by default. Visibility adds the rest of an area's policy.
 */
export interface AreaDefinition {
	readonly alwaysPrivate?: boolean;
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
	/**
	 * Its areas by full id: its own, which has the module's id and exists even when left out, and others named
	 * `<module>.<name>`. Each action asks for a level in one of them.
	 */
	readonly areas?: Readonly<Record<string, AreaDefinition>>;
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
/** The name an area adds after its module's id and a dot. */
const AREA_NAME = /^[a-z][a-z0-9]*$/;
const LEVELS: ReadonlySet<unknown> = new Set(["read", "write", "manage"]);
/** The platform's own id: the prefix of its tables and the owner of its rows in `platform_migrations`. No module may take it. */
export const PLATFORM_ID = "platform";

/**
 * Checks a list of module definitions before they are registered: by createPlatform and by the module list
 * generator. Throws on the first problem, naming the module, and the action when the problem is one.
 */
export function checkModules(modules: readonly ModuleDefinition[]): void {
	const seen = new Set<string>();
	const actionNames = new Set<string>();
	const areas = new Set([PLATFORM_ID, ...modules.flatMap((module) => areaIds(module))]);
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
		checkAreas(module);
		checkPermissions(module, areas);
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

/** The ids of a module's areas: its own and those it declares. */
export function areaIds(module: ModuleDefinition): readonly string[] {
	return [...new Set([module.id, ...Object.keys(module.areas ?? {})])];
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

/** Each area it declares is its own or `<module>.<name>`. */
function checkAreas(module: ModuleDefinition): void {
	for (const area of Object.keys(module.areas ?? {})) {
		if (area === module.id) continue;
		const prefix = `${module.id}.`;
		if (!area.startsWith(prefix) || !AREA_NAME.test(area.slice(prefix.length)))
			throw new Error(
				`module "${module.id}": area "${area}" must be "${module.id}" or "${module.id}.<name>"`,
			);
	}
}

/**
 * Every action declares its permission: a known level, never `read` for a write, in a registered area (the
 * module's own when it names none). Its type already asks for one; this catches a contract made around it.
 */
function checkPermissions(module: ModuleDefinition, areas: ReadonlySet<string>): void {
	for (const [name, contract] of Object.entries(module.contract ?? {})) {
		const fullName = `${module.id}.${name}`;
		const meta = contract["~orpc"].meta as Partial<ActionMeta> | undefined;
		const permission = meta?.permission;
		if (!permission || !LEVELS.has(permission.level))
			throw new Error(`module "${module.id}": action "${fullName}" declares no permission`);
		if (meta.kind === "write" && (permission.level as string) === "read")
			throw new Error(
				`module "${module.id}": action "${fullName}" is a write and cannot ask only for read`,
			);
		const area = permission.area ?? module.id;
		if (!areas.has(area))
			throw new Error(
				`module "${module.id}": action "${fullName}" asks for area "${area}", which is not registered`,
			);
	}
}

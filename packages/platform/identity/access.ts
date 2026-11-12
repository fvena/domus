// What authorization reads, from the platform's tables: each account's role and its stored permission rows,
// and the registered areas (ADR 0023). Every read is a prepared statement on the one connection, so the
// decision stays synchronous inside a write's transaction and always sees the rows of that moment.
import {
	type AreaDefinition,
	areaIds,
	type ModuleDefinition,
	PLATFORM_ID,
} from "@domus/module-sdk";
import type Database from "better-sqlite3";

import type { AccessView, AreaPolicy, Grant, Role } from "../authorization";

/** Every registered area: the platform's own and each module's, with what each declares. */
export function registeredAreas(
	modules: readonly ModuleDefinition[],
): ReadonlyMap<string, AreaPolicy> {
	const areas = new Map<string, AreaPolicy>([[PLATFORM_ID, policyOf(undefined)]]);
	for (const module of modules)
		for (const id of areaIds(module)) areas.set(id, policyOf(module.areas?.[id]));
	return areas;
}

function policyOf(definition: AreaDefinition | undefined): AreaPolicy {
	return { alwaysPrivate: definition?.alwaysPrivate === true };
}

/** The view authorization decides on, over `connection` and the registered `areas`. */
export function accessView(
	connection: Database.Database,
	areas: ReadonlyMap<string, AreaPolicy>,
): AccessView {
	const role = connection.prepare<[string], { role: Role }>(
		"SELECT role FROM platform_roles WHERE account = ?",
	);
	const stored = connection.prepare<[string, string], { level: Grant }>(
		"SELECT level FROM platform_permissions WHERE account = ? AND area = ?",
	);
	return {
		roleOf: (account) => role.get(account)?.role,
		storedGrant: (account, area) => stored.get(account, area)?.level,
		area: (id) => areas.get(id),
	};
}

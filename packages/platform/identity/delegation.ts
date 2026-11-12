// The delegation table of each account (ADR 0023): what it lets Kira do on its behalf, `no`, `yes` or `confirm`
// per area and level, each on its own. It is written once, when the account is created, from the permission of
// that moment, and never follows later changes of permission. Reading it is an operation of the platform that
// authorization decides like any other; changing it is sensitive and arrives with step-up proofs (ticket 09).
import { PLATFORM_ID } from "@domus/module-sdk";
import type { PermissionLevel } from "@domus/module-sdk/contracts";
import { ORPCError } from "@orpc/server";
import type Database from "better-sqlite3";

import {
	type AreaPolicy,
	type Authorizer,
	type Delegated,
	grantOf,
	isAllowed,
	isVerified,
	reaches,
	type VerifiedContext,
} from "../authorization";
import { accessView } from "./access";

const LEVELS: readonly PermissionLevel[] = ["read", "write", "manage"];

/** An account's delegation: each registered area with its three levels. A level without a row is `no`. */
export type DelegationTable = Readonly<
	Record<string, Readonly<Record<PermissionLevel, Delegated>>>
>;

/** The full name authorization sees for reading a delegation table. */
const READ_DELEGATION = "platform.readDelegation";

/** Stores one level of one area of the account's delegation. */
export function setDelegation(
	connection: Database.Database,
	account: string,
	area: string,
	level: PermissionLevel,
	value: Delegated,
): void {
	connection
		.prepare(
			"INSERT INTO platform_delegation (account, area, level, value) VALUES (?, ?, ?, ?) ON CONFLICT (account, area, level) DO UPDATE SET value = excluded.value",
		)
		.run(account, area, level, value);
}

/**
 * Writes the account's first delegation, in every registered area: `read` and `write` copy its permission of
 * this moment, `yes` when it has it and `no` when not; `manage` starts at `no`, and nothing at `confirm`.
 */
export function startDelegation(
	connection: Database.Database,
	areas: ReadonlyMap<string, AreaPolicy>,
	account: string,
): void {
	const view = accessView(connection, areas);
	for (const area of areas.keys()) {
		const grant = grantOf(view, account, area);
		setDelegation(connection, account, area, "read", reaches(grant, "read") ? "yes" : "no");
		setDelegation(connection, account, area, "write", reaches(grant, "write") ? "yes" : "no");
		setDelegation(connection, account, area, "manage", "no");
	}
}

/** The account's delegation in every registered area, `no` where it has no row. */
function delegationTable(
	connection: Database.Database,
	areas: ReadonlyMap<string, AreaPolicy>,
	account: string,
): DelegationTable {
	const view = accessView(connection, areas);
	return Object.fromEntries(
		[...areas.keys()].map((area) => [
			area,
			Object.fromEntries(
				LEVELS.map((level) => [level, view.delegated(account, area, level) ?? "no"]),
			) as Record<PermissionLevel, Delegated>,
		]),
	);
}

export interface DelegationReader {
	readonly connection: Database.Database;
	readonly areas: ReadonlyMap<string, AreaPolicy>;
	readonly authorizer: Authorizer;
}

/**
 * Reads the delegation of `account`, a read of the platform's area: each person reads their own and the admin
 * the device account's, never another person's. Via Kira it needs that read delegated. Denied: forbidden.
 */
export function readDelegation(
	{ connection, areas, authorizer }: DelegationReader,
	context: VerifiedContext,
	account: string,
): DelegationTable {
	if (!isVerified(context)) throw new ORPCError("INTERNAL_SERVER_ERROR");
	const allowed = isAllowed(authorizer, {
		context,
		action: READ_DELEGATION,
		kind: "read",
		permission: { area: PLATFORM_ID, level: "read" },
		input: { account },
		subject: account,
	});
	if (!allowed) throw new ORPCError("FORBIDDEN");
	return delegationTable(connection, areas, account);
}

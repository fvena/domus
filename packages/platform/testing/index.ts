// What only test-utils takes from platform (ADR 0021, ADR 0022, ADR 0023): the Drizzle client of a module, behind
// dbFor; a platform with the real authorization and a clock the test chooses; the way to invoke its actions and
// undo their entries with a verified context; synthetic verified contexts; the privileged preparation of
// accounts, roles, passwords and permission rows, without a session or a proof; and a read of its action log. A
// rule of .dependency-cruiser.cjs keeps every other importer out, production code of platform included; the
// main entry offers none of it.
import { hashPassword } from "better-auth/crypto";

import type { ActionCall, Clock, UndoCall, WriteOutcome } from "../actions";
import type { LogEntry } from "../audit";
import { type Grant, type Role, sealContext, type VerifiedContext } from "../authorization";
import {
	ensureDeviceAccount,
	insertAccount,
	type NewAccount,
	setGrant,
	setPasswordHash,
} from "../identity/accounts";
import {
	actionLogOf,
	actionsOf,
	clockOf,
	connectionOf,
	openPlatform,
	type Platform,
	type PlatformOptions,
} from "../platform";

export type { Acknowledgement, WriteOutcome, WriteReceipt } from "../actions";
export type { LogEntry } from "../audit";
export type {
	Channel,
	Grant,
	IdentityProof,
	PermissionLevel,
	Role,
	VerifiedContext,
} from "../authorization";
export { type ModuleDatabase, moduleDatabase } from "./module-database";

/** A platform like createPlatform's, with the real authorization, and the clock the test gives it. */
export function createPlatformWithClock(options: PlatformOptions, clock: Clock): Platform {
	return openPlatform(options, { clock });
}

/** Runs an action through the platform's one path: validation, authorization, handler, result and, for a write, its log entry. */
export function invokeAction(platform: Platform, call: ActionCall): unknown {
	return actionsOf(platform).invoke(call);
}

/** Undoes an entry through the platform's one path: its stored inverse, the checks and one new log entry. */
export function undoEntry(platform: Platform, call: UndoCall): WriteOutcome {
	return actionsOf(platform).undo(call);
}

/** Every entry of the action log, in order, with its content even when expired. A copy: changing it changes nothing. */
export function readLog(platform: Platform): readonly LogEntry[] {
	return actionLogOf(platform).entries();
}

/**
 * A verified context with any combination of its fields, such as a member recognized by voice on a device
 * signed in with the device account. Production builds one only from a session, at the door.
 */
export function syntheticContext(fields: VerifiedContext): VerifiedContext {
	return sealContext(fields);
}

/** Creates an account with its role, without a password. Returns its id. */
export function prepareAccount(
	platform: Platform,
	account: NewAccount & { readonly role: Exclude<Role, "device"> },
): string {
	return insertAccount(connectionOf(platform), account, clockOf(platform)());
}

/** True when an account with this id exists. */
export function hasAccount(platform: Platform, account: string): boolean {
	return (
		connectionOf(platform).prepare("SELECT 1 FROM platform_user WHERE id = ?").get(account) !==
		undefined
	);
}

/** Gives an account a password, hashed as Better Auth hashes it, so it can sign in over HTTP. */
export async function preparePassword(
	platform: Platform,
	account: string,
	password: string,
): Promise<void> {
	const hash = await hashPassword(password);
	setPasswordHash(connectionOf(platform), account, hash, clockOf(platform)());
}

/** Stores the row that replaces the default of the account's role in the area. */
export function prepareGrant(
	platform: Platform,
	account: string,
	area: string,
	grant: Grant,
): void {
	setGrant(connectionOf(platform), account, area, grant);
}

/** The id of the one device account, which the platform created at start. */
export function deviceAccountOf(platform: Platform): string {
	return ensureDeviceAccount(connectionOf(platform), clockOf(platform)());
}

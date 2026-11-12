import { ORPCError } from "@orpc/server";
// What only test-utils takes from platform (ADR 0021, ADR 0022, ADR 0023): the Drizzle client of a module, behind
// dbFor; a platform with the real authorization and a clock the test chooses; the way to invoke its actions and
// undo their entries with a verified context; synthetic verified contexts; the privileged preparation of
// accounts, roles, passwords, permission rows, delegation rows and sessions, without a session or a proof; the
// platform's real read of a delegation table and real request of a step-up proof; and a read of its action log. A rule of .dependency-cruiser.cjs keeps every
// other importer out, production code of platform included; the main entry offers none of it.
import { hashPassword } from "better-auth/crypto";

import type { ActionCall, Clock, ConfirmationCall, UndoCall, WriteOutcome } from "../actions";
import type { LogEntry } from "../audit";
import {
	type Delegated,
	type Grant,
	type PermissionLevel,
	type Role,
	sealContext,
	type VerifiedContext,
} from "../authorization";
import {
	ensureDeviceAccount,
	insertAccount,
	type NewAccount,
	randomId,
	setGrant,
	setPasswordHash,
} from "../identity/accounts";
import { type DelegationTable, readDelegation, setDelegation } from "../identity/delegation";
import {
	type IssuedProof,
	type ProofRequest,
	requestProof,
	WrongPasswordError,
} from "../identity/proofs";
import {
	actionLogOf,
	actionsOf,
	areasOf,
	delegationReaderOf,
	clockOf,
	connectionOf,
	openPlatform,
	type Platform,
	type PlatformOptions,
	proofIssuerOf,
} from "../platform";

export type { Acknowledgement, ProvenOperation, WriteOutcome, WriteReceipt } from "../actions";
export type { IssuedProof, ProofRequest } from "../identity/proofs";
export type { LogEntry } from "../audit";
export type { DelegationTable } from "../identity/delegation";
export type {
	Channel,
	Delegated,
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

/** Confirms a pending confirmation through the platform's real operation, and returns what its operation does. */
export function confirmPending(platform: Platform, call: ConfirmationCall): unknown {
	return actionsOf(platform).confirm(call);
}

/** Rejects a pending confirmation through the platform's real operation. */
export function rejectPending(platform: Platform, call: ConfirmationCall): void {
	actionsOf(platform).reject(call);
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
	return insertAccount(connectionOf(platform), account, areasOf(platform), clockOf(platform)());
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

/** Stores one level of one area of the account's delegation, without a session or a proof. */
export function prepareDelegation(
	platform: Platform,
	account: string,
	area: string,
	level: PermissionLevel,
	value: Delegated,
): void {
	setDelegation(connectionOf(platform), account, area, level, value);
}

/** Reads the delegation of `account` through the platform's real operation, decided by its authorization. */
export function readDelegationOf(
	platform: Platform,
	context: VerifiedContext,
	account: string,
): DelegationTable {
	return readDelegation(delegationReaderOf(platform), context, account);
}

/**
 * Asks for a step-up proof through the platform's real operation: the password is checked as Better Auth does.
 * A wrong one is thrown as `FORBIDDEN` with `reason: "wrong-password"`, as the door answers it.
 */
export async function requestProofOf(
	platform: Platform,
	context: VerifiedContext,
	request: ProofRequest,
): Promise<IssuedProof> {
	try {
		return await requestProof(proofIssuerOf(platform), context, request);
	} catch (error) {
		if (error instanceof WrongPasswordError)
			throw new ORPCError("FORBIDDEN", { data: { reason: "wrong-password" } });
		throw error;
	}
}

/**
 * Opens a session of the account on a device, as signing in would, without a password: on the device given, or
 * on a new one. Returns the ids of both, for synthetic contexts that come with a real session.
 */
export function prepareSession(
	platform: Platform,
	account: string,
	device?: string,
): { readonly session: string; readonly device: string } {
	const connection = connectionOf(platform);
	const now = clockOf(platform)();
	const onDevice = device ?? randomId();
	connection
		.prepare("INSERT OR IGNORE INTO platform_devices (id, created_at) VALUES (?, ?)")
		.run(onDevice, now);
	const session = randomId();
	connection
		.prepare(
			"INSERT INTO platform_session (id, user_id, device_id, token, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
		)
		.run(session, account, onDevice, randomId(), now + 7 * 24 * 60 * 60 * 1000, now, now);
	return { session, device: onDevice };
}

/** True while a session with this id exists. */
export function hasSession(platform: Platform, session: string): boolean {
	return (
		connectionOf(platform)
			.prepare("SELECT 1 FROM platform_session WHERE id = ?")
			.get(session) !== undefined
	);
}

/** The id of the one device account, which the platform created at start. */
export function deviceAccountOf(platform: Platform): string {
	return ensureDeviceAccount(connectionOf(platform), areasOf(platform), clockOf(platform)());
}

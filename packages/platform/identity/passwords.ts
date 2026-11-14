// Passwords of an account, and the sessions a new one ends (ADR 0023), shared by `pnpm accounts` and the
// platform's operations over HTTP; its sessions themselves live in `sessions.ts`. Hashing and checking are Better Auth's own, so a password set here signs in through its routes. Each
// operation does the slow, asynchronous hashing first and then writes its rows in one synchronous transaction on
// the one connection, so it is all or nothing and nothing else interleaves with it. Passwords never reach the
// action log: these are not actions.
import { hashPassword, verifyPassword } from "better-auth/crypto";
import type Database from "better-sqlite3";

import { endConfirmationsOf } from "../actions/confirmations";
import { endProofsOf } from "../actions/proofs";
import type { AreaPolicy, Role } from "../authorization";
import { PASSWORD_LENGTH } from "../contracts";
import { insertAccount, setPasswordHash } from "./accounts";
import { sessionLives } from "./sessions";

/** Why a password is not accepted, or `undefined` when it is. Never repeats the password. */
export function passwordProblem(password: string): string | undefined {
	if (password.length < PASSWORD_LENGTH.min)
		return `the password needs at least ${PASSWORD_LENGTH.min} characters`;
	if (password.length > PASSWORD_LENGTH.max)
		return `the password has at most ${PASSWORD_LENGTH.max} characters`;
	return undefined;
}

/** An account found by its email, which is stored in lower case. */
export function accountByEmail(
	connection: Database.Database,
	email: string,
): { readonly id: string; readonly role: Role } | undefined {
	return connection
		.prepare<[string], { id: string; role: Role }>(
			"SELECT u.id, r.role FROM platform_user u JOIN platform_roles r ON r.account = u.id WHERE u.email = ?",
		)
		.get(email.toLowerCase());
}

/**
 * Creates an account with its role, its starting delegation over the registered `areas` and its password, in
 * one transaction. A repeated email throws.
 */
export async function createAccountWithPassword(
	connection: Database.Database,
	account: { readonly name: string; readonly email: string; readonly role: "admin" | "member" },
	areas: ReadonlyMap<string, AreaPolicy>,
	password: string,
	now: number,
): Promise<string> {
	const hash = await hashPassword(password);
	let id = "";
	connection.transaction(() => {
		id = insertAccount(connection, account, areas, now);
		setPasswordHash(connection, id, hash, now);
	})();
	return id;
}

/**
 * Sets a new password and ends the account's sessions, all but `keep` when it is given, in one transaction.
 * Returns how many sessions ended.
 */
export async function replacePassword(
	connection: Database.Database,
	account: string,
	password: string,
	now: number,
	keep?: string,
): Promise<number> {
	const lives = sessionLives(connection);
	const hash = await hashPassword(password);
	return connection.transaction(() => {
		if (keep !== undefined && !lives(account, keep, now)) throw new SessionGoneError();
		setPasswordHash(connection, account, hash, now);
		endConfirmationsOf(connection, account);
		endProofsOf(connection, account);
		return connection
			.prepare("DELETE FROM platform_session WHERE user_id = ? AND id IS NOT ?")
			.run(account, keep ?? null).changes;
	})();
}

/** The session to keep was revoked while the new password was being hashed. */
export class SessionGoneError extends Error {
	constructor() {
		super("the session ended while its password was being changed");
	}
}

/**
 * The stored hash `password` was verified against, when it is the account's current one; `undefined` when it is
 * not or the account has none. Read the hash again later to tell whether the password changed in between.
 */
export async function verifiedPasswordHash(
	connection: Database.Database,
	account: string,
	password: string,
): Promise<string | undefined> {
	const hash = passwordHashOf(connection, account);
	if (!hash) return undefined;
	return (await verifyPassword({ hash, password })) ? hash : undefined;
}

/**
 * The stored hash of the account's current password, `undefined` when it has none. Setting a password stores a
 * new hash, salted anew, so the same one read again tells whether the password changed in between.
 */
export function passwordHashOf(connection: Database.Database, account: string): string | undefined {
	return (
		connection
			.prepare<[string], string | null>(
				"SELECT password FROM platform_account WHERE user_id = ? AND provider_id = 'credential'",
			)
			.pluck()
			.get(account) ?? undefined
	);
}

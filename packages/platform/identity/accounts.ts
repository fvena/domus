// The rows of an account (ADR 0023): its Better Auth user, its role, its credential and its permission rows.
// Plain synchronous writes on the one connection, without a session or a proof: only what the platform does by
// itself (the device account at start) and the privileged preparation of the testing entry call them. The
// command that creates accounts (ticket 04) builds on the same functions.
import { randomBytes } from "node:crypto";

import type Database from "better-sqlite3";

import type { Grant, Role } from "../authorization";

/** The provider of email and password in Better Auth's account table. */
const CREDENTIAL = "credential";

/** Where the device account is reached; `.invalid` can never be a real address (RFC 2606). */
export const DEVICE_ACCOUNT_EMAIL = "device@domus.invalid";

export interface NewAccount {
	/** Chosen by the caller only in tests; otherwise random. */
	readonly id?: string;
	readonly name: string;
	readonly email: string;
	readonly role: Role;
}

/** A random id of 32 characters, like Better Auth's. */
export function randomId(): string {
	return randomBytes(24).toString("base64url");
}

/** Inserts the account and its role in one transaction, and returns its id. A repeated email throws. */
export function insertAccount(
	connection: Database.Database,
	{ id = randomId(), name, email, role }: NewAccount,
	now: number,
): string {
	connection.transaction(() => {
		connection
			.prepare(
				"INSERT INTO platform_user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)",
			)
			.run(id, name, email.toLowerCase(), now, now);
		connection
			.prepare("INSERT INTO platform_roles (account, role) VALUES (?, ?)")
			.run(id, role);
	})();
	return id;
}

/**
 * Sets the account's password hash, made with Better Auth's `hashPassword`. Its credential row has the
 * account's id as `account_id`, as Better Auth looks it up.
 */
export function setPasswordHash(
	connection: Database.Database,
	account: string,
	hash: string,
	now: number,
): void {
	const updated = connection
		.prepare(
			"UPDATE platform_account SET password = ?, updated_at = ? WHERE user_id = ? AND provider_id = ?",
		)
		.run(hash, now, account, CREDENTIAL);
	if (updated.changes > 0) return;
	connection
		.prepare(
			"INSERT INTO platform_account (id, account_id, provider_id, user_id, password, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
		)
		.run(randomId(), account, CREDENTIAL, account, hash, now, now);
}

/** Stores the row that replaces the default of the account's role in the area. */
export function setGrant(
	connection: Database.Database,
	account: string,
	area: string,
	grant: Grant,
): void {
	connection
		.prepare(
			"INSERT INTO platform_permissions (account, area, level) VALUES (?, ?, ?) ON CONFLICT (account, area) DO UPDATE SET level = excluded.level",
		)
		.run(account, area, grant);
}

/**
 * The id of the one device account, created without a password when it is missing. Without a credential it
 * cannot sign in over HTTP until pairing arrives (phase 3).
 */
export function ensureDeviceAccount(connection: Database.Database, now: number): string {
	const found = connection
		.prepare<[], { account: string }>(
			"SELECT account FROM platform_roles WHERE role = 'device'",
		)
		.get();
	if (found) return found.account;
	return insertAccount(
		connection,
		{ name: "Aparato compartido", email: DEVICE_ACCOUNT_EMAIL, role: "device" },
		now,
	);
}

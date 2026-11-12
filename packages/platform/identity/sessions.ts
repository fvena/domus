// The sessions of an account (ADR 0023), as the platform reads them: one by its id, with its account and device,
// and the listing its owner sees. A session's token and its device's id, which the device cookie carries, never
// leave here: the listing names each device by an opaque id derived from it.
import { createHash } from "node:crypto";

import type Database from "better-sqlite3";

/** A session by its id: whose it is and the device it was born on. */
export interface SessionOwner {
	readonly account: string;
	readonly device: string;
}

/** Finds sessions by their id on one connection; `undefined` when there is none. */
export type SessionLookup = (session: string) => SessionOwner | undefined;

/** The one lookup of a session by its id, prepared on `connection`. */
export function sessionLookup(connection: Database.Database): SessionLookup {
	const statement = connection.prepare<[string], SessionOwner>(
		"SELECT user_id AS account, device_id AS device FROM platform_session WHERE id = ?",
	);
	return (session) => statement.get(session);
}

/** Whether `session` exists and is the account's. */
export function sessionExists(
	connection: Database.Database,
	account: string,
	session: string,
): boolean {
	return sessionLookup(connection)(session)?.account === account;
}

/** One of an account's sessions, as its owner sees it: never its token, and its device by an opaque id. */
export interface SessionSummary {
	readonly id: string;
	readonly current: boolean;
	readonly createdAt: number;
	readonly expiresAt: number;
	readonly device: {
		/** The same for every session on that device; never the id the device cookie carries. */
		readonly id: string;
		readonly name: string | null;
		readonly createdAt: number;
	};
}

/**
 * The account's live sessions, newest first. Better Auth decides expiry against the real time, so the listing
 * does too, and agrees with what the next request would find.
 */
export function sessionsOf(
	connection: Database.Database,
	account: string,
	current: string | undefined,
): SessionSummary[] {
	return connection
		.prepare<
			[string, number],
			{
				id: string;
				createdAt: number;
				expiresAt: number;
				device: string;
				deviceName: string | null;
				deviceCreatedAt: number;
			}
		>(
			`SELECT s.id, s.created_at AS createdAt, s.expires_at AS expiresAt,
				d.id AS device, d.name AS deviceName, d.created_at AS deviceCreatedAt
			FROM platform_session s JOIN platform_devices d ON d.id = s.device_id
			WHERE s.user_id = ? AND s.expires_at > ?
			ORDER BY s.created_at DESC, s.id`,
		)
		.all(account, Date.now())
		.map((row) => ({
			id: row.id,
			current: row.id === current,
			createdAt: row.createdAt,
			expiresAt: row.expiresAt,
			device: {
				id: opaqueDeviceId(row.device),
				name: row.deviceName,
				createdAt: row.deviceCreatedAt,
			},
		}));
}

/**
 * An id for a device that groups its sessions without giving away the one its cookie carries: a hash of it,
 * which cannot be turned back into the cookie.
 */
function opaqueDeviceId(device: string): string {
	return createHash("sha256").update(`domus.device:${device}`).digest("base64url").slice(0, 22);
}

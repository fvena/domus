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

/**
 * The SQL condition that a session still lives: one with the id of the expression `session` exists, is the
 * account's of the expression `account` and has not expired by the instant of the expression `now`, the platform
 * clock's. A session past its expiry has ended though its row is still there. The one form of that rule, for
 * statements and for {@link sessionLives}.
 */
export function sessionLivesWhere(session: string, account: string, now: string): string {
	return `EXISTS (SELECT 1 FROM platform_session
		WHERE id = ${session} AND user_id = ${account} AND expires_at > ${now})`;
}

/**
 * The SQL condition that the session of the expression `session` is the one its device has enabled for notices
 * (ADR 0029): its `deviceEntry` equals its device's `entry`. Every session entering a device writes a new `entry`
 * before it is created, so at most one session of a device matches, an earlier one never again, and none when the
 * creation failed after writing it. It says nothing of whether the session lives: {@link sessionLivesWhere} does.
 */
export function sessionEnabledWhere(session: string): string {
	return `EXISTS (SELECT 1 FROM platform_session s JOIN platform_devices d ON d.id = s.device_id
		WHERE s.id = ${session} AND s.device_entry = d.entry)`;
}

/** Whether a session still lives at the instant `now`: it exists, is the account's and has not expired. */
export type SessionLives = (account: string, session: string, now: number) => boolean;

/** The check that a session still lives, prepared on `connection`. */
export function sessionLives(connection: Database.Database): SessionLives {
	const statement = connection.prepare<[string, string, number], { lives: number }>(
		`SELECT ${sessionLivesWhere("?", "?", "?")} AS lives`,
	);
	return (account, session, now) => statement.get(session, account, now)?.lives === 1;
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

/** Ends every session of every account inside the caller's transaction: restoring does it. */
export function endEverySession(connection: Database.Database): void {
	connection.prepare("DELETE FROM platform_session").run();
}

/**
 * An id for a device that groups its sessions without giving away the one its cookie carries: a hash of it,
 * which cannot be turned back into the cookie.
 */
function opaqueDeviceId(device: string): string {
	return createHash("sha256").update(`domus.device:${device}`).digest("base64url").slice(0, 22);
}

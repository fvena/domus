// Pending confirmations (ADR 0023): where an operation that authorization asked to confirm waits, in
// `platform_confirmations`. Each one keeps the exact operation, its fingerprint, a write's key, the verified
// context it was born in and two absolute deadlines fixed when it is created. Prepared statements on the one
// connection, synchronous, so the path of the actions reads and changes them inside its own transactions.
// Expiry is checked when one is reached; removing old rows arrives with phase 1d.
import type { Actor } from "@domus/module-sdk";
import type Database from "better-sqlite3";

import type { VerifiedContext } from "../authorization";
import { randomId } from "../identity/accounts";

/** What waits: an action with its validated input, or the undo of an entry. */
export type PendingOperation =
	| { readonly action: string; readonly input: unknown }
	| { readonly undo: number };

/** Where a pending confirmation stands: waiting, run once, refused, or ended by its session or password. */
export type PendingState = "pending" | "consumed" | "rejected" | "ended";

/** The verified context a pending confirmation was born in, as stored: plain fields, not a sealed context. */
export type Origin = VerifiedContext;

export interface PendingConfirmation {
	readonly id: string;
	readonly account: string;
	readonly via?: string;
	readonly kind: "read" | "write";
	readonly operation: PendingOperation;
	readonly fingerprint: string;
	/** A write's idempotency key. */
	readonly key?: string;
	readonly origin: Origin;
	readonly windowClosesAt: number;
	readonly expiresAt: number;
	/**
	 * Only the channel `contexto` may confirm it, inside its window, which is also when it expires: born of the
	 * shared device rule (ADR 0023). By the app it is not found.
	 */
	readonly contextOnly: boolean;
	/** `ended` too when the session it was born in was revoked. */
	readonly state: PendingState;
}

/** A new pending confirmation, before it gets its id and its deadlines. */
export interface NewPending {
	readonly kind: "read" | "write";
	readonly operation: PendingOperation;
	readonly fingerprint: string;
	readonly key?: string;
	readonly origin: VerifiedContext;
	/** Confirmed only in context, and expiring when its window closes. */
	readonly contextOnly?: boolean;
}

/** The two deadlines of a new pending confirmation, in milliseconds from its birth. */
export interface ConfirmationTimes {
	/** How long it can be confirmed in the conversation it was born in. */
	readonly window: number;
	/** How long it can be confirmed at all. */
	readonly expiry: number;
}

export interface Confirmations {
	/** The pending confirmation with this id, whatever its state. */
	find(id: string): PendingConfirmation | undefined;
	/** The write waiting under the actor's key, whatever its state: a key names one operation. */
	findWrite(actor: Actor, key: string): PendingConfirmation | undefined;
	/**
	 * A read still waiting with this fingerprint, for the same account and via, from the same session or, without
	 * one, the same conversation.
	 */
	findRead(
		origin: VerifiedContext,
		fingerprint: string,
		now: number,
	): PendingConfirmation | undefined;
	/** Stores a new one with its deadlines from `now` and returns its id. */
	create(pending: NewPending, now: number): string;
	/** Marks it consumed, linked to the entry a write logged. */
	consume(id: string, entry: number | undefined): void;
	reject(id: string): void;
}

interface Row {
	readonly id: string;
	readonly account: string;
	readonly via: string | null;
	readonly kind: "read" | "write";
	readonly operation: string;
	readonly fingerprint: string;
	readonly key: string | null;
	readonly origin: string;
	readonly window_closes_at: number;
	readonly expires_at: number;
	readonly context_only: number;
	readonly state: PendingState;
	/** 0 when it was bound to a session that is gone. */
	readonly live: number;
}

const COLUMNS = `id, account, via, kind, operation, fingerprint, key, origin, window_closes_at, expires_at,
	context_only, state, (bound = 0 OR session IS NOT NULL) AS live`;

export function createConfirmations(
	connection: Database.Database,
	times: ConfirmationTimes,
): Confirmations {
	const byId = connection.prepare<[string], Row>(
		`SELECT ${COLUMNS} FROM platform_confirmations WHERE id = ?`,
	);
	const byKey = connection.prepare<[string, string | null, string], Row>(
		`SELECT ${COLUMNS} FROM platform_confirmations
		WHERE account = ? AND via IS ? AND kind = 'write' AND key = ?`,
	);
	const reads = connection.prepare<[string, string | null, string, number], Row>(
		`SELECT ${COLUMNS} FROM platform_confirmations
		WHERE account = ? AND via IS ? AND kind = 'read' AND fingerprint = ? AND state = 'pending'
			AND expires_at > ? AND (bound = 0 OR session IS NOT NULL)
		ORDER BY created_at`,
	);
	const sessionExists = connection.prepare<[string], 1>(
		"SELECT 1 FROM platform_session WHERE id = ?",
	);
	const insert = connection.prepare(
		`INSERT INTO platform_confirmations (id, account, via, kind, operation, fingerprint, key, origin, session,
			bound, created_at, window_closes_at, expires_at, context_only, state)
		VALUES (@id, @account, @via, @kind, @operation, @fingerprint, @key, @origin, @session, @bound, @createdAt,
			@windowClosesAt, @expiresAt, @contextOnly, 'pending')`,
	);
	const settle = connection.prepare<[PendingState, number | null, string]>(
		"UPDATE platform_confirmations SET state = ?, entry = ? WHERE id = ? AND state = 'pending'",
	);

	return {
		find: (id) => pendingOf(byId.get(id)),
		findWrite: (actor, key) => pendingOf(byKey.get(actor.account, actor.via ?? null, key)),
		findRead: (origin, fingerprint, now) =>
			reads
				.all(origin.account, origin.via ?? null, fingerprint, now)
				.map((row) => pendingOf(row))
				.find(
					(pending) =>
						pending !== undefined &&
						(origin.session === undefined
							? pending.origin.session === undefined &&
								pending.origin.conversation === origin.conversation
							: pending.origin.session === origin.session),
				),
		create: ({ kind, operation, fingerprint, key, origin, contextOnly = false }, now) => {
			const id = randomId();
			// Bound to its session only when that session is a real one: revoking it then ends this one.
			const session =
				origin.session !== undefined && sessionExists.get(origin.session) !== undefined
					? origin.session
					: null;
			insert.run({
				id,
				account: origin.account,
				via: origin.via ?? null,
				kind,
				operation: JSON.stringify(operation),
				fingerprint,
				key: key ?? null,
				origin: JSON.stringify(origin),
				session,
				bound: session === null ? 0 : 1,
				createdAt: now,
				windowClosesAt: now + times.window,
				// One confirmed only in context has no later life: it expires with its window.
				expiresAt: now + (contextOnly ? times.window : times.expiry),
				contextOnly: contextOnly ? 1 : 0,
			});
			return id;
		},
		consume: (id, entry) => {
			settle.run("consumed", entry ?? null, id);
		},
		reject: (id) => {
			settle.run("rejected", null, id);
		},
	};
}

function pendingOf(row: Row | undefined): PendingConfirmation | undefined {
	if (!row) return undefined;
	return {
		id: row.id,
		account: row.account,
		...(row.via === null ? {} : { via: row.via }),
		kind: row.kind,
		operation: JSON.parse(row.operation) as PendingOperation,
		fingerprint: row.fingerprint,
		...(row.key === null ? {} : { key: row.key }),
		origin: JSON.parse(row.origin) as Origin,
		windowClosesAt: row.window_closes_at,
		expiresAt: row.expires_at,
		contextOnly: row.context_only === 1,
		state: row.state === "pending" && row.live === 0 ? "ended" : row.state,
	};
}

/**
 * Ends every pending confirmation born on the device still waiting, as revoking the device does, inside the
 * caller's transaction.
 */
export function endConfirmationsOnDevice(connection: Database.Database, device: string): void {
	connection
		.prepare(
			"UPDATE platform_confirmations SET state = 'ended' WHERE state = 'pending' AND json_extract(origin, '$.device') = ?",
		)
		.run(device);
}

/**
 * Ends every pending confirmation of the account still waiting, as changing its password does, inside the
 * caller's transaction.
 */
export function endConfirmationsOf(connection: Database.Database, account: string): void {
	connection
		.prepare(
			"UPDATE platform_confirmations SET state = 'ended' WHERE account = ? AND state = 'pending'",
		)
		.run(account);
}

// The keys of the connected apps (ADR 0030): a key says which app calls, never on whose behalf. Its form is
// `domus_<id>.<secret>`, a public id of 8 random bytes and a secret of 32, both in base64url; the prefix lets
// gitleaks catch one that slipped into a commit. The database keeps only the SHA-256 of the secret. Keys are not
// actions (ADR 0008): only `keys`, the command of the api container, creates, lists and revokes them.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import type Database from "better-sqlite3";

/** A program that talks to Domus through the API with its own key. Being one gives no permission. */
export interface ConnectedApp {
	/** Its name, the `via` of what it does on someone's behalf. */
	readonly name: string;
	/** Whether it may receive mandates: adding another app that may is an express decision (ADR 0030). */
	readonly mandates: boolean;
}

/** The connected apps of production, a fixed list like the modules': Kira alone, which may receive mandates. */
export const CONNECTED_APPS: readonly ConnectedApp[] = [{ name: "kira", mandates: true }];

/** The id and the secret of a key, as {@link parseKey} reads them. */
export interface KeyParts {
	readonly id: string;
	readonly secret: string;
}

const KEY = /^domus_([A-Za-z0-9_-]{11})\.([A-Za-z0-9_-]{43})$/;

/** How many random bytes the id and the secret of a key carry. */
const ID_BYTES = 8;
const SECRET_BYTES = 32;

/**
 * Reads a key of the form `domus_<id>.<secret>`: its parts, or `undefined` for any other form, so a bad key is
 * refused before the database is asked. Each part must be the exact base64url, without padding, of its bytes.
 */
export function parseKey(key: string): KeyParts | undefined {
	const match = KEY.exec(key);
	const id = match?.[1];
	const secret = match?.[2];
	if (id === undefined || secret === undefined) return undefined;
	if (!encodes(id, ID_BYTES) || !encodes(secret, SECRET_BYTES)) return undefined;
	return { id, secret };
}

/** Whether `text` is the one base64url form of exactly `bytes` bytes. */
function encodes(text: string, bytes: number): boolean {
	const decoded = Buffer.from(text, "base64url");
	return decoded.length === bytes && decoded.toString("base64url") === text;
}

/**
 * Creates a key of `app`, which must be one of `apps`, at the instant `now`, and returns it whole: the only time it
 * exists outside the hands of whoever asked for it. The database keeps its id and the hash of its secret.
 */
export function createKey(
	connection: Database.Database,
	apps: readonly ConnectedApp[],
	app: string,
	now: number,
): string {
	if (!apps.some(({ name }) => name === app)) throw new UnknownAppError();
	const id = randomBytes(ID_BYTES).toString("base64url");
	const secret = randomBytes(SECRET_BYTES).toString("base64url");
	connection
		.prepare("INSERT INTO platform_keys (id, app, secret_hash, created_at) VALUES (?, ?, ?, ?)")
		.run(id, app, hashOf(secret), now);
	return `domus_${id}.${secret}`;
}

/** A key as the listing shows it: never its secret nor its hash. */
export interface ListedKey {
	readonly id: string;
	readonly app: string;
	readonly createdAt: number;
	readonly lastUsedAt: number | null;
	readonly revokedAt: number | null;
}

/** Every key, revoked ones included, from the oldest. */
export function listKeys(connection: Database.Database): readonly ListedKey[] {
	return connection
		.prepare<[], ListedKey>(
			`SELECT id, app, created_at AS createdAt, last_used_at AS lastUsedAt, revoked_at AS revokedAt
				FROM platform_keys ORDER BY created_at, rowid`,
		)
		.all();
}

/** What revoking a key did: revoked it, found it already revoked, or found no key with that id. */
export type KeyRevocation =
	| { readonly kind: "revoked"; readonly app: string }
	| { readonly kind: "already"; readonly revokedAt: number }
	| { readonly kind: "unknown" };

/** Revokes the key `id` at the instant `now`, keeping its row. One already revoked keeps its instant. */
export function revokeKey(connection: Database.Database, id: string, now: number): KeyRevocation {
	return connection
		.transaction((): KeyRevocation => {
			const row = connection
				.prepare<[string], { app: string; revokedAt: number | null }>(
					"SELECT app, revoked_at AS revokedAt FROM platform_keys WHERE id = ?",
				)
				.get(id);
			if (!row) return { kind: "unknown" };
			if (row.revokedAt !== null) return { kind: "already", revokedAt: row.revokedAt };
			connection.prepare("UPDATE platform_keys SET revoked_at = ? WHERE id = ?").run(now, id);
			return { kind: "revoked", app: row.app };
		})
		.immediate();
}

/** The app asked for is not one of the connected apps. */
export class UnknownAppError extends Error {
	constructor() {
		super("unknown connected app");
	}
}

/**
 * What checking a key found: the app it is of, or why it is bad. Whoever calls gives every failure the same
 * answer; the reason is only for the operator's log, and never comes with the key.
 */
export type KeyCheck =
	| { readonly ok: true; readonly id: string; readonly app: string }
	| {
			readonly ok: false;
			readonly reason: "malformed" | "unknown" | "wrong-secret" | "revoked" | "unknown-app";
	  };

/**
 * Checks a key: of the agreed form, with a known id, the secret whose hash that id keeps, compared in constant
 * time, not revoked, and of an app still in `apps`.
 */
export function checkKey(
	connection: Database.Database,
	apps: readonly ConnectedApp[],
	key: string,
): KeyCheck {
	const parts = parseKey(key);
	if (!parts) return { ok: false, reason: "malformed" };
	const row = connection
		.prepare<[string], { app: string; secretHash: string; revokedAt: number | null }>(
			"SELECT app, secret_hash AS secretHash, revoked_at AS revokedAt FROM platform_keys WHERE id = ?",
		)
		.get(parts.id);
	if (!row) return { ok: false, reason: "unknown" };
	const given = Buffer.from(hashOf(parts.secret), "hex");
	const kept = Buffer.from(row.secretHash, "hex");
	if (given.length !== kept.length || !timingSafeEqual(given, kept))
		return { ok: false, reason: "wrong-secret" };
	if (row.revokedAt !== null) return { ok: false, reason: "revoked" };
	if (!apps.some(({ name }) => name === row.app)) return { ok: false, reason: "unknown-app" };
	return { ok: true, id: parts.id, app: row.app };
}

/** The SHA-256 of a key's secret, in hex: what the database keeps. */
function hashOf(secret: string): string {
	return createHash("sha256").update(secret).digest("hex");
}

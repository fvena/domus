// The mandates of the connected apps (ADR 0030): a mandate says on whose behalf an app acts. The door issues it
// from an interaction it authenticated, for one app; it is a row of `platform_mandates` with the verified context of
// that interaction, kept under the SHA-256 of its id, and it lives until it expires or its session ends. Here the
// door reads it from a request and resolves it. Issuing one lives in `platform/testing` alone until phase 5a, so no
// production code reaches it.
import { createHash } from "node:crypto";

import type Database from "better-sqlite3";

import type { IdentityProof } from "../authorization";
import { type SessionOrigin, sessionLivesWhere } from "./sessions";

/** How many random bytes the id of a mandate carries. */
export const MANDATE_BYTES = 32;

const MANDATE = /^[A-Za-z0-9_-]{43}$/;

/** What a request's `domus-mandate` header carries: none, the id of a mandate, or a bad one. */
export type MandateRead =
	| { readonly kind: "none" }
	| { readonly kind: "mandate"; readonly id: string }
	| { readonly kind: "bad" };

/**
 * Reads the value of `domus-mandate`, `null` when the request has none: the exact base64url, without padding, of
 * {@link MANDATE_BYTES} bytes, spaces around ignored as HTTP does. Any other form is a bad mandate, never none.
 */
export function readMandate(value: string | null): MandateRead {
	if (value === null) return { kind: "none" };
	const id = value.trim();
	if (!MANDATE.test(id) || Buffer.from(id, "base64url").toString("base64url") !== id)
		return { kind: "bad" };
	return { kind: "mandate", id };
}

/** The SHA-256 of a mandate's id, in hex: what the database keeps, so a copy of it holds no usable mandate. */
export function mandateHash(id: string): string {
	return createHash("sha256").update(id).digest("hex");
}

/** The verified context a mandate keeps: that of the session it was born of, and its conversation, if any. */
export interface MandateOrigin extends SessionOrigin {
	readonly conversation?: string;
}

/**
 * What resolving a mandate found: the origin it keeps, or why it does not resolve. Whoever calls gives every failure
 * the same answer as no mandate; the reason is only for the operator's log, and never comes with the mandate.
 */
export type MandateResolution =
	| { readonly ok: true; readonly origin: MandateOrigin }
	| {
			readonly ok: false;
			readonly reason: "unknown" | "expired" | "other-app" | "session-ended";
	  };

/**
 * Resolves the mandate `id` for a request with a good key of `app` at the instant `now`, the platform clock's: it
 * exists, has not expired (from `now >= expiresAt` it is no longer good), was issued for that app and its session
 * still lives by the one rule of the platform, which is how ending that session ends it on the next request.
 */
export function resolveMandate(
	connection: Database.Database,
	id: string,
	app: string,
	now: number,
): MandateResolution {
	const row = connection
		.prepare<
			[number, string],
			{
				app: string;
				account: string;
				device: string;
				session: string;
				deviceAccount: string;
				identity: IdentityProof;
				conversation: string | null;
				expiresAt: number;
				lives: number;
			}
		>(
			`SELECT app, account, device, session, device_account AS deviceAccount, identity, conversation,
				expires_at AS expiresAt, ${sessionLivesWhere("m.session", "m.account", "?")} AS lives
			FROM platform_mandates m WHERE hash = ?`,
		)
		.get(now, mandateHash(id));
	if (!row) return { ok: false, reason: "unknown" };
	if (now >= row.expiresAt) return { ok: false, reason: "expired" };
	if (row.app !== app) return { ok: false, reason: "other-app" };
	if (row.lives !== 1) return { ok: false, reason: "session-ended" };
	return {
		ok: true,
		origin: {
			account: row.account,
			device: row.device,
			session: row.session,
			deviceAccount: row.deviceAccount,
			identity: row.identity,
			...(row.conversation === null ? {} : { conversation: row.conversation }),
		},
	};
}

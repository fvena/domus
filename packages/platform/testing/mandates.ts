// Issuing a mandate (ADR 0030): the one function that creates one, from a session that lives and for one app that
// receives mandates. It lives here, in what only test-utils reaches, because phase 1e issues no mandate in
// production: the rule production-never-reaches-platform-testing keeps every production chain of imports away from
// it. Phase 5a moves it into `identity`, beside resolving one, when the door issues mandates from real interactions.
import { randomBytes } from "node:crypto";

import type { IdentityProof } from "../authorization";
import { sha256Hex } from "../identity/credentials";
import { connectedApp } from "../identity/keys";
import { MANDATE_BYTES } from "../identity/mandates";
import { originOf, sessionLives, sessionLookup } from "../identity/sessions";
import { appsOf, clockOf, connectionOf, mandateLifeOf, type Platform } from "../platform";

/** What a mandate is issued from: the session of its origin, the app it is for and its conversation, if any. */
export interface MandateIssue {
	readonly session: string;
	readonly app: string;
	readonly conversation?: string;
}

/**
 * Issues a mandate for `app` from the session `session`, at the instant of the platform's clock and good for its
 * mandate life, and returns its id: the only time it exists outside the hands of whoever asked for it. The account,
 * the device, the device account and the identity are the session's, never the caller's. An app that receives no
 * mandates and a session that does not live throw.
 */
export function issueMandate(
	platform: Platform,
	{ session, app, conversation }: MandateIssue,
): string {
	const connection = connectionOf(platform);
	const now = clockOf(platform)();
	if (!connectedApp(appsOf(platform), app)?.receivesMandates)
		throw new Error(`connected app "${app}" receives no mandates`);
	const owner = sessionLookup(connection)(session);
	if (!owner || !sessionLives(connection)(owner.account, session, now))
		throw new Error("the session of a mandate must live");
	const origin = originOf(session, owner);
	const id = randomBytes(MANDATE_BYTES).toString("base64url");
	connection
		.prepare(
			`INSERT INTO platform_mandates (hash, app, account, device, session, device_account, identity,
				conversation, issued_at, expires_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.run(
			sha256Hex(id),
			app,
			origin.account,
			origin.device,
			origin.session,
			origin.deviceAccount,
			origin.identity,
			conversation ?? null,
			now,
			now + mandateLifeOf(platform),
		);
	return id;
}

/** A mandate as its row keeps it, without the hash of its id. */
export interface MandateRow {
	readonly app: string;
	readonly account: string;
	readonly device: string;
	readonly session: string;
	readonly deviceAccount: string;
	readonly identity: IdentityProof;
	readonly conversation: string | null;
	readonly issuedAt: number;
	readonly expiresAt: number;
}

/** Every mandate row, oldest first, expired ones and those of an ended session included. Plain data: changing it changes nothing. */
export function readMandates(platform: Platform): readonly MandateRow[] {
	return connectionOf(platform)
		.prepare<[], MandateRow>(
			`SELECT app, account, device, session, device_account AS deviceAccount, identity, conversation,
				issued_at AS issuedAt, expires_at AS expiresAt
			FROM platform_mandates ORDER BY issued_at, rowid`,
		)
		.all();
}

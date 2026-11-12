// Step-up proofs (ADR 0023): what giving the password again earns for one exact sensitive operation, in
// `platform_proofs`. A proof is random and only its SHA-256 is stored. It is bound to the account, the session
// and the device it was asked from and to the operation's fingerprint, it is good once and for five minutes, and
// it is used inside the transaction of the operation it proves, so an operation that rolls back leaves it unused.
// Revoking its session or its device ends it while unused; changing the password ends it even once used. Prepared statements on the one
// connection, synchronous, like the path of the actions that checks them.
import { createHash, randomBytes } from "node:crypto";

import type Database from "better-sqlite3";

import type { VerifiedContext } from "../authorization";

/** How long a proof is good for: five minutes. */
export const PROOF_LIFETIME = 5 * 60 * 1000;

/** What a proof brought to an operation is worth for it, as authorization takes it. */
export type ProofCheck = "valid" | "invalid";

export interface Proofs {
	/**
	 * Stores a new proof for `context` and the operation's `fingerprint`, and returns it with the instant it
	 * expires. The proof itself is returned once and never stored.
	 */
	issue(
		context: VerifiedContext,
		fingerprint: string,
		now: number,
	): { readonly proof: string; readonly expiresAt: number };
	/**
	 * What `proof` is worth for this operation: `valid` when it was issued for the context's account, session
	 * and device and this fingerprint, its session lives, and it is unused and before its expiry. When `entry` is
	 * given, a proof that write already used is valid too: a repeat of it is acknowledged. `undefined` when no
	 * proof is brought.
	 */
	check(
		proof: string | undefined,
		context: VerifiedContext,
		fingerprint: string,
		now: number,
		entry?: number,
	): ProofCheck | undefined;
	/** Marks a proof used, inside the operation's transaction. */
	use(proof: string): void;
	/** Links a used proof to the entry of the write it proved. */
	link(proof: string, entry: number): void;
}

interface Row {
	readonly account: string;
	readonly origin_session: string | null;
	readonly device: string;
	readonly fingerprint: string;
	readonly expires_at: number;
	readonly state: "issued" | "used" | "ended";
	readonly entry: number | null;
	/** 0 when it was bound to a session that is gone. */
	readonly live: number;
}

export function createProofs(connection: Database.Database): Proofs {
	const sessionExists = connection.prepare<[string], 1>(
		"SELECT 1 FROM platform_session WHERE id = ?",
	);
	const insert = connection.prepare(
		`INSERT INTO platform_proofs (hash, account, session, origin_session, bound, device, fingerprint, created_at,
			expires_at, state)
		VALUES (@hash, @account, @session, @originSession, @bound, @device, @fingerprint, @createdAt, @expiresAt,
			'issued')`,
	);
	const byHash = connection.prepare<[string], Row>(
		`SELECT account, origin_session, device, fingerprint, expires_at, state, entry,
			(bound = 0 OR session IS NOT NULL) AS live
		FROM platform_proofs WHERE hash = ?`,
	);
	const markUsed = connection.prepare<[string]>(
		"UPDATE platform_proofs SET state = 'used' WHERE hash = ? AND state = 'issued'",
	);
	const markEntry = connection.prepare<[number, string]>(
		"UPDATE platform_proofs SET entry = ? WHERE hash = ? AND state = 'used'",
	);

	return {
		issue: (context, fingerprint, now) => {
			const proof = randomBytes(32).toString("base64url");
			// Bound to its session only when that session is a real one: revoking it then ends this proof.
			const live =
				context.session !== undefined && sessionExists.get(context.session) !== undefined;
			const expiresAt = now + PROOF_LIFETIME;
			insert.run({
				hash: hashOf(proof),
				account: context.account,
				session: live ? context.session : null,
				originSession: context.session ?? null,
				bound: live ? 1 : 0,
				device: context.device,
				fingerprint,
				createdAt: now,
				expiresAt,
			});
			return { proof, expiresAt };
		},
		check: (proof, context, fingerprint, now, entry) => {
			if (proof === undefined) return undefined;
			const row = byHash.get(hashOf(proof));
			const matches =
				row !== undefined &&
				row.live === 1 &&
				row.account === context.account &&
				row.origin_session === (context.session ?? null) &&
				row.device === context.device &&
				row.fingerprint === fingerprint &&
				((row.state === "issued" && now < row.expires_at) ||
					(entry !== undefined && row.state === "used" && row.entry === entry));
			return matches ? "valid" : "invalid";
		},
		use: (proof) => {
			markUsed.run(hashOf(proof));
		},
		link: (proof, entry) => {
			markEntry.run(entry, hashOf(proof));
		},
	};
}

/** Whether a session with this id exists. */
export function sessionLives(connection: Database.Database, session: string): boolean {
	return (
		connection.prepare("SELECT 1 FROM platform_session WHERE id = ?").get(session) !== undefined
	);
}

/**
 * Ends every proof of the account, unused or already used, as changing its password does, inside the caller's
 * transaction: a used one no longer acknowledges a repeat of its write either.
 */
export function endProofsOf(connection: Database.Database, account: string): void {
	connection
		.prepare(
			"UPDATE platform_proofs SET state = 'ended' WHERE account = ? AND state IN ('issued', 'used')",
		)
		.run(account);
}

/** Ends every proof asked from the device still unused, as revoking it does, inside the caller's transaction. */
export function endProofsOnDevice(connection: Database.Database, device: string): void {
	connection
		.prepare("UPDATE platform_proofs SET state = 'ended' WHERE device = ? AND state = 'issued'")
		.run(device);
}

/** The SHA-256 of a proof, the only form of it the database keeps. */
function hashOf(proof: string): string {
	return createHash("sha256").update(proof).digest("hex");
}

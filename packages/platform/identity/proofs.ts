// Asking for a step-up proof (ADR 0023), an operation of the platform: the person gives their password again for
// one exact sensitive operation and gets a proof bound to their account, session, device and that operation's
// fingerprint, good once and for five minutes. Only an identity proven by password can ask, never one by voice
// or by the device. The password is checked first, asynchronously, and the proof stored after, in one
// synchronous transaction that checks the password checked is still the current one. Neither the password nor
// the proof is ever logged or echoed.
import { ORPCError } from "@orpc/server";
import type Database from "better-sqlite3";

import type { Actions, Clock, ProvenOperation } from "../actions";
import { type Proofs, sessionExists } from "../actions/proofs";
import { isVerified, type VerifiedContext } from "../authorization";
import { passwordHashOf, verifiedPasswordHash } from "./passwords";
import { sessionLives } from "./sessions";

export interface ProofIssuer {
	readonly connection: Database.Database;
	readonly actions: Actions;
	readonly proofs: Proofs;
	readonly clock: Clock;
}

export interface ProofRequest {
	/** The account's current password. */
	readonly password: string;
	/** The operation the proof is for, with the exact input it will run with. */
	readonly operation: ProvenOperation;
}

/** A new step-up proof, returned only here, and the instant it stops being good. */
export interface IssuedProof {
	readonly proof: string;
	readonly expiresAt: number;
}

/** The password given is not the account's current one. */
export class WrongPasswordError extends Error {
	constructor() {
		super("wrong password");
	}
}

/**
 * A step-up proof for `operation`, once `password` is the account's current one. Throws `FORBIDDEN` for an
 * identity not proven by password, the errors of an unknown or invalid operation or one that is not sensitive,
 * {@link WrongPasswordError}, and `UNAUTHORIZED` when the session ended, or expired, before the proof is stored.
 * A password changed while it was being checked is no longer the current one, so it is a wrong password too
 * (ADR 0023: changing the password ends its proofs): the answer reveals no more than giving the new one wrong.
 */
export async function requestProof(
	{ connection, actions, proofs, clock }: ProofIssuer,
	context: VerifiedContext,
	{ password, operation }: ProofRequest,
): Promise<IssuedProof> {
	if (!isVerified(context)) throw new ORPCError("INTERNAL_SERVER_ERROR");
	if (context.identity !== "password") throw new ORPCError("FORBIDDEN");
	const fingerprint = actions.fingerprintOf(operation);
	const { session } = context;
	const bound = session !== undefined && sessionExists(connection, session);
	const lives = sessionLives(connection);
	const checked = await verifiedPasswordHash(connection, context.account, password);
	if (checked === undefined) throw new WrongPasswordError();
	return connection.transaction(() => {
		if (bound && !lives(context.account, session, clock())) throw new ORPCError("UNAUTHORIZED");
		if (passwordHashOf(connection, context.account) !== checked) throw new WrongPasswordError();
		return proofs.issue(context, fingerprint, clock());
	})();
}

// How a write on the path of the actions takes its step-up proof (ADR 0023): the proof is checked, authorization
// weighs what it is worth, and a valid one is used before the write runs and linked to its entry after, all
// inside the write's transaction, so a write that rolls back leaves it unused.
import type { AuthorizationRequest, VerifiedContext } from "../authorization";
import type { ProofCheck, Proofs } from "./proofs";

/** Runs `operation`, a write that logs an entry, with the proof it brings. */
export type Proven = <TReceipt extends { readonly entry: number }>(
	proof: string | undefined,
	context: VerifiedContext,
	fingerprint: string,
	requestWith: (checked: ProofCheck | undefined) => AuthorizationRequest,
	operation: () => TReceipt,
) => TReceipt;

/**
 * The proof handling of writes over `proofs`, with the platform `clock` and `authorize`, which throws unless
 * authorization allows the request.
 */
export function provingWith(
	proofs: Proofs,
	clock: () => number,
	authorize: (request: AuthorizationRequest) => void,
): Proven {
	return (proof, context, fingerprint, requestWith, operation) => {
		const checked = proofs.check(proof, context, fingerprint, clock());
		authorize(requestWith(checked));
		if (proof === undefined || checked !== "valid") return operation();
		proofs.use(proof);
		const receipt = operation();
		proofs.link(proof, receipt.entry);
		return receipt;
	};
}

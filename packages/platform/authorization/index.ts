// The only place where permission is decided (ADR 0010, ADR 0022). Synchronous, because writes ask it inside
// their transaction. Until phase 1c there is no identity and no real decision: production denies everything,
// and only the testing entry of platform can put another authorizer.
import type { Actor } from "@domus/module-sdk";

/** What an action asks before it runs: who, which action by its full name, and its validated input. */
export interface AuthorizationRequest {
	readonly actor: Actor;
	readonly action: string;
	readonly input: unknown;
}

/** Phase 1c adds asking for confirmation. */
export type Decision = "allow" | "deny";

export type Authorizer = (request: AuthorizationRequest) => Decision;

/** The production authorizer of phase 1b: no action runs until real authorization exists (phase 1c). */
export const denyEverything: Authorizer = () => "deny";

/** Fails closed: only an explicit "allow" lets the action run; a denial, any other answer or a throw stop it. */
export function isAllowed(authorizer: Authorizer, request: AuthorizationRequest): boolean {
	try {
		return authorizer(request) === "allow";
	} catch {
		return false;
	}
}

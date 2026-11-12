// The only place where permission is decided (ADR 0010, ADR 0023). `decide` is a pure, synchronous function,
// because writes ask it inside their transaction: it takes the verified context, the action with the permission
// its contract declares, the validated input and a read-only view of roles, permissions and areas. The steps
// that later tickets add sit where the comments in `decide` say. Fails closed: a throw denies.
import type { PermissionLevel } from "@domus/module-sdk/contracts";

import type { VerifiedContext } from "./context";

export {
	actorOf,
	type Channel,
	type IdentityProof,
	isVerified,
	sealContext,
	type VerifiedContext,
} from "./context";

export type { PermissionLevel };

/** What an account may have in an area: a {@link PermissionLevel}, or nothing. */
export type Grant = PermissionLevel | "none";

/** What an account can do in general (GLOSSARY: perfil). */
export type Role = "admin" | "member" | "device";

/** An action's permission once registered: the area is always named. */
export interface RequiredPermission {
	readonly area: string;
	readonly level: PermissionLevel;
}

/**
 * What an action asks before it runs: the verified context, which action by its full name, the permission its
 * contract declares and its validated input. When the action is the inverse an undo runs, `undoes` carries
 * the context of the entry it undoes.
 */
export interface AuthorizationRequest {
	readonly context: VerifiedContext;
	readonly action: string;
	readonly permission: RequiredPermission;
	readonly input: unknown;
	readonly undoes?: UndoContext;
}

/** The entry an undo undoes: its number, the action it logged by its full name, and who asked for it. */
export interface UndoContext {
	readonly entry: number;
	readonly action: string;
	readonly actor: { readonly account: string; readonly via?: string };
}

/** What an area declares that the decision reads. */
export interface AreaPolicy {
	readonly alwaysPrivate: boolean;
}

/** A read-only view of what the decision reads. Production reads it from the platform's tables. */
export interface AccessView {
	/** The account's role, or `undefined` for an account that does not exist. */
	roleOf(account: string): Role | undefined;
	/** The row stored for the account in the area, which replaces its role's default, if there is one. */
	storedGrant(account: string, area: string): Grant | undefined;
	/** The area, if it is registered. */
	area(id: string): AreaPolicy | undefined;
}

/** Later tickets add asking for confirmation and for a step-up proof. */
export type Decision = "allow" | "deny";

export type Authorizer = (request: AuthorizationRequest) => Decision;

const RANK: Readonly<Record<Grant, number>> = { none: 0, read: 1, write: 2, manage: 3 };

/**
 * What a role has in an area when no row says otherwise: admin `manage` everywhere, member `write`, and the
 * device account `read`, but nothing in an `alwaysPrivate` area.
 */
export function defaultGrant(role: Role, area: AreaPolicy): Grant {
	switch (role) {
		case "admin":
			return "manage";
		case "member":
			return "write";
		case "device":
			return area.alwaysPrivate ? "none" : "read";
	}
}

/** The account's grant in the area: its role's default, replaced by a stored row except for the admin. */
export function grantOf(view: AccessView, account: string, areaId: string): Grant {
	const role = view.roleOf(account);
	const area = view.area(areaId);
	if (role === undefined || area === undefined) return "none";
	// The admin keeps manage in every area: no row can lower it.
	if (role === "admin") return "manage";
	return view.storedGrant(account, areaId) ?? defaultGrant(role, area);
}

/** True when `grant` reaches `level`: each level includes the ones before it. */
export function reaches(grant: Grant, level: PermissionLevel): boolean {
	return RANK[grant] >= RANK[level];
}

/** The decision, in the order of ADR 0023. Pure: everything it reads comes in `request` and `view`. */
export function decide(request: AuthorizationRequest, view: AccessView): Decision {
	const { context, permission } = request;
	// 1. The represented account's permission in the area reaches the level asked for.
	if (!reaches(grantOf(view, context.account, permission.area), permission.level)) return "deny";
	// 2. Via Kira, the account's delegation for that area and level (ticket 07).
	// 3. Sensitive operations ask for a step-up proof (ticket 09).
	// 4. An action that always asks for confirmation (ticket 08).
	// 5. The shared device rule for `confirmOnSharedDevice` areas (ticket 08).
	return "allow";
}

/** The production authorizer: {@link decide} over the view it is given. */
export function createAuthorizer(view: AccessView): Authorizer {
	return (request) => decide(request, view);
}

/** Fails closed: only an explicit "allow" lets the action run; a denial, any other answer or a throw stop it. */
export function isAllowed(authorizer: Authorizer, request: AuthorizationRequest): boolean {
	try {
		return authorizer(request) === "allow";
	} catch {
		return false;
	}
}

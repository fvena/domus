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

/**
 * What an account lets Kira do on its behalf at one level of one area (GLOSSARY: tabla de delegación): `no`,
 * `yes`, or `confirm`, which asks the person first. Each level stands alone: one never carries another.
 */
export type Delegated = "no" | "yes" | "confirm";

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
	/**
	 * For an operation of the platform on one account's own settings, such as its delegation table: that
	 * account. Only the account itself reaches them, and the admin those of the device account.
	 */
	readonly subject?: string;
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
	/** The account's delegation row for the level of the area, if there is one: without a row it is `no`. */
	delegated(account: string, area: string, level: PermissionLevel): Delegated | undefined;
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

/** True when `account` may reach the own settings of `subject`: its own, or the device account's as admin. */
function reachesSettingsOf(view: AccessView, account: string, subject: string): boolean {
	if (view.roleOf(account) === undefined) return false;
	if (account === subject) return true;
	return view.roleOf(account) === "admin" && view.roleOf(subject) === "device";
}

/** What the account delegates for the permission: `no` when it has no row. */
export function delegationOf(
	view: AccessView,
	account: string,
	{ area, level }: RequiredPermission,
): Delegated {
	return view.delegated(account, area, level) ?? "no";
}

/** The decision, in the order of ADR 0023. Pure: everything it reads comes in `request` and `view`. */
export function decide(request: AuthorizationRequest, view: AccessView): Decision {
	const { context, permission, subject } = request;
	// An account's own settings: only that account, or the admin for the device account.
	if (subject !== undefined && !reachesSettingsOf(view, context.account, subject)) return "deny";
	// 1. The represented account's permission in the area reaches the level asked for.
	if (!reaches(grantOf(view, context.account, permission.area), permission.level)) return "deny";
	// 2. Via Kira, the represented account's delegation for that area and level: `no` and an area without a
	// row deny. `confirm` denies too until pending confirmations exist (ticket 08).
	if (context.via !== undefined && delegationOf(view, context.account, permission) !== "yes")
		return "deny";
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

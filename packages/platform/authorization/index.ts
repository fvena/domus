// The only place where permission is decided (ADR 0010, ADR 0023). `decide` is a pure, synchronous function,
// because writes ask it inside their transaction: it takes the verified context, the action with the permission
// its contract declares, the validated input and a read-only view of roles, permissions, delegation and areas,
// and answers in the order of ADR 0023. Fails closed: a throw denies.
import type { Visibility } from "@domus/module-sdk";
import type { PermissionLevel } from "@domus/module-sdk/contracts";

import type { VerifiedContext } from "./context";
import { admitsVia } from "./via";

export { newOwnership, visibleTo } from "./visibility";

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
	/** The action asks for confirmation every time, whoever asks (GLOSSARY: confirmación pendiente). */
	readonly alwaysConfirm?: boolean;
}

/**
 * What an action asks before it runs: the verified context, which action by its full name, whether it reads
 * or writes, the permission its contract declares and its validated input. When the action is the inverse an
 * undo runs, `undoes` carries the context of the entry it undoes. `confirmed` says the person has confirmed
 * this very operation: the requirement to confirm counts as met, and only that one.
 */
export interface AuthorizationRequest {
	readonly context: VerifiedContext;
	readonly action: string;
	readonly kind: "read" | "write";
	readonly permission: RequiredPermission;
	readonly input: unknown;
	readonly undoes?: UndoContext;
	readonly confirmed?: boolean;
	/**
	 * Who confirmed it, when it runs a pending confirmation a person answered: the context of that answer, by the app
	 * and without via. The operation keeps the context it was born with for everything else; only the proof the
	 * answer brings is that person's, not of who asked.
	 */
	readonly confirmedBy?: Pick<VerifiedContext, "channel" | "via">;
	/**
	 * For an operation of the platform on one account's own settings, such as its delegation table: that
	 * account. Only the account itself reaches them, and the admin those of the device account. Changing
	 * permissions has its own rule: only the admin, on a member or the device account.
	 */
	readonly subject?: string;
	/**
	 * A sensitive operation of the platform (GLOSSARY: comprobante): changing permissions or a delegation table,
	 * or revoking sessions or a device. An action is sensitive by its `manage` level.
	 */
	readonly sensitive?: SensitiveOperation;
	/**
	 * An operation of the platform a person asks for themselves, with no level of any area, such as the test notice
	 * (ADR 0029): only a person's account, from the app and by itself. It needs no proof.
	 */
	readonly personal?: true;
	/**
	 * The step-up proof the request brings, as the path of the actions found it: `valid` when it was issued for
	 * this account, session, device and exact operation and is still usable; `invalid` otherwise. Absent when
	 * it brings none. The proof itself never reaches here.
	 */
	readonly proof?: "valid" | "invalid";
}

/** The sensitive operations of the platform: changing access or delegation, and revoking sessions or devices. */
export type SensitiveOperation = "permissions" | "delegation" | "sessions";

/** The entry an undo undoes: its number, the action it logged by its full name, and who asked for it. */
export interface UndoContext {
	readonly entry: number;
	readonly action: string;
	readonly actor: { readonly account: string; readonly via?: string };
}

/** What an area declares, each field with its default filled in (`AreaDefinition` of module-sdk). */
export interface AreaPolicy {
	readonly defaultVisibility: Visibility;
	readonly publicEditable: boolean;
	readonly alwaysPrivate: boolean;
	readonly confirmOnSharedDevice: boolean;
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

/** Every decision, the one list the type and the fail-closed check of {@link decisionOf} come from. */
const DECISIONS = ["allow", "deny", "confirm", "step-up"] as const;

/**
 * Allow, deny, ask the person to confirm first (a pending confirmation, answered from the app), or ask for a step-up
 * proof of this exact operation (GLOSSARY: comprobante).
 */
export type Decision = (typeof DECISIONS)[number];

const KNOWN_DECISIONS: ReadonlySet<unknown> = new Set(DECISIONS);

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
export function reachesSettingsOf(view: AccessView, account: string, subject: string): boolean {
	if (view.roleOf(account) === undefined) return false;
	if (account === subject) return true;
	return view.roleOf(account) === "admin" && view.roleOf(subject) === "device";
}

/**
 * True when `account` may change the permissions of `subject`: only the admin, on a member or the device
 * account. So nobody changes their own.
 */
function changesPermissionsOf(view: AccessView, account: string, subject: string): boolean {
	const role = view.roleOf(subject);
	return view.roleOf(account) === "admin" && (role === "member" || role === "device");
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
	const { context, permission, subject, sensitive } = request;
	// Via an agent, of the platform's own operations only reading one's annotations and undoing one's entry.
	if (context.via !== undefined && !admitsVia(request.action, request.undoes !== undefined))
		return "deny";
	// A person's own operation asks for no level: who asks is all that counts. A proof does not match it.
	if (request.personal === true) {
		if (context.channel !== "app" || !personByItself(view, context)) return "deny";
		return request.proof === undefined ? "allow" : "step-up";
	}
	// Permissions: only the admin, on another account. An account's own settings: only that account, or the
	// admin for the device account.
	if (sensitive === "permissions") {
		if (subject === undefined || !changesPermissionsOf(view, context.account, subject))
			return "deny";
	} else if (subject !== undefined && !reachesSettingsOf(view, context.account, subject))
		return "deny";
	// 1. The represented account's permission in the area reaches the level asked for.
	if (!reaches(grantOf(view, context.account, permission.area), permission.level)) return "deny";
	// Each later step may deny or ask for confirmation; a denial wins, and confirmation is asked only once.
	let ask = false;
	// 2. Via Kira, the represented account's delegation for that area and level: `no` and an area without a
	// row deny, `confirm` asks the person.
	if (context.via !== undefined) {
		const delegated = delegationOf(view, context.account, permission);
		if (delegated === "no") return "deny";
		if (delegated === "confirm") ask = true;
	}
	// 3. Sensitive operations ask for a step-up proof, which only an identity proven by password can bring; via
	// Kira, changing access or delegation is denied whatever it brings. A proof counts only when a person brings it
	// by the channel `app` and without via: one the person asked for in the app proves nothing when an agent brings
	// it, so via an agent it counts only when the person confirms from the app (ADR 0030, ADR 0034). A proof brought to an operation that is not sensitive does not match it either.
	let stepUp = false;
	if (permission.level === "manage" || sensitive !== undefined) {
		if (context.identity !== "password") return "deny";
		if (
			context.via !== undefined &&
			(sensitive === "permissions" || sensitive === "delegation")
		)
			return "deny";
		const bringer = request.confirmedBy ?? context;
		if (request.proof !== "valid" || !asksByItself(bringer) || bringer.channel !== "app")
			stepUp = true;
	} else if (request.proof !== undefined) stepUp = true;
	// 4. An action that always asks for confirmation.
	if (permission.alwaysConfirm === true) ask = true;
	// 5. The shared device rule: the device account never reads an area that declares `confirmOnSharedDevice`, even
	// with a row that grants it, so nothing private leaves through a shared screen (ADR 0023, ADR 0034).
	if (
		request.kind === "read" &&
		view.roleOf(context.account) === "device" &&
		view.area(permission.area)?.confirmOnSharedDevice === true
	)
		return "deny";
	// Confirming comes first: an operation that asks both takes its proof when it is confirmed.
	if (ask && request.confirmed !== true) return "confirm";
	return stepUp ? "step-up" : "allow";
}

/** The production authorizer: {@link decide} over the view it is given. */
export function createAuthorizer(view: AccessView): Authorizer {
	return (request) => decide(request, view);
}

/** Fails closed: only an explicit "allow" lets the action run; a denial, any other answer or a throw stop it. */
export function isAllowed(authorizer: Authorizer, request: AuthorizationRequest): boolean {
	return decisionOf(authorizer, request) === "allow";
}

/** The authorizer's decision, failing closed: a throw or any answer it does not know denies. */
export function decisionOf(authorizer: Authorizer, request: AuthorizationRequest): Decision {
	try {
		const decision: unknown = authorizer(request);
		return KNOWN_DECISIONS.has(decision) ? (decision as Decision) : "deny";
	} catch {
		return "deny";
	}
}

/**
 * Whether the context may upload a file (ADR 0028), an operation of the platform: a person's account, by itself.
 * Never the device account, which is shared and would leave a file without a person behind it, nor an agent: phase 5
 * decides how an agent reaches its conversations' attachments (ADR 0034).
 */
export function mayUpload(view: AccessView, context: VerifiedContext): boolean {
	return personByItself(view, context);
}

/**
 * Whether the context may subscribe its device to notices (ADR 0029, «La suscripción no es una acción»): a person's
 * account, by itself. Never the device account, which is shared and has nobody to tell, nor Kira, nor an account
 * without a role.
 */
export function maySubscribe(view: AccessView, context: VerifiedContext): boolean {
	return personByItself(view, context);
}

/**
 * Whether the context asks by itself, with no agent in between: no via. The only way to the operations of the platform
 * that stay outside the path of the actions (changing one's password, listing one's sessions, asking for a step-up
 * proof, confirming or rejecting a pending confirmation), so an agent reaches none of them (ADR 0030, ADR 0034).
 */
export function asksByItself(context: Pick<VerifiedContext, "via">): boolean {
	return context.via === undefined;
}

/** A person's account, admin or member, asking by itself: no via. */
function personByItself(view: AccessView, context: VerifiedContext): boolean {
	return asksByItself(context) && isPerson(view, context.account);
}

/** Whether `account` is a person's: admin or member, never the device account nor one without a role. */
export function isPerson(view: AccessView, account: string): boolean {
	const role = view.roleOf(account);
	return role === "admin" || role === "member";
}

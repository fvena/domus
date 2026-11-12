// What platform answers over RPC, besides the modules. Pure: schemas and contracts only, so the
// browser, assistant and voice-gateway can import it (@domus/platform/contracts).
import { oc } from "@orpc/contract";
import { z } from "zod";

/**
 * Version of the contract between the api and the programs that call it. Raise it with any change
 * those programs cannot understand; they stop acting until both sides speak the same one.
 */
export const PROTOCOL = 1;

/** Public on purpose: it carries no personal data. Nothing else is public by default. */
export const statusContract = oc.output(
	z.object({
		service: z.literal("domus"),
		protocol: z.number().int(),
	}),
);

/** How long a password may be, in characters: Better Auth's own bounds, applied by every way of setting one. */
export const PASSWORD_LENGTH = { min: 8, max: 128 } as const;

/**
 * Changing one's own password from the app: it asks for the current one, keeps only the session it comes from
 * and ends the others. A wrong current password answers `FORBIDDEN`; no error repeats either password.
 */
export const changePasswordContract = oc
	.errors({ FORBIDDEN: { data: z.object({ reason: z.literal("wrong-password") }) } })
	.input(
		z.object({
			currentPassword: z.string().min(1).max(PASSWORD_LENGTH.max),
			newPassword: z.string().min(PASSWORD_LENGTH.min).max(PASSWORD_LENGTH.max),
		}),
	)
	.output(z.object({ endedSessions: z.number().int() }));

/** One's own sessions, newest first, with their device; never another account's. */
export const listSessionsContract = oc.output(
	z.array(
		z.object({
			id: z.string(),
			/** The session this request comes with. */
			current: z.boolean(),
			createdAt: z.number().int(),
			expiresAt: z.number().int(),
			device: z.object({ name: z.string().nullable(), createdAt: z.number().int() }),
		}),
	),
);

/**
 * What `CONFIRMATION_REQUIRED` carries: the id of the pending confirmation the operation waits as. Its status
 * is 428; an action answers it when the person must confirm first (ADR 0023).
 */
export const confirmationRequiredData = z.object({ confirmation: z.string() });

/** A pending confirmation by its id. */
const pendingConfirmation = z.object({ id: z.string().min(1).max(64) });

/**
 * Confirming one of one's own pending confirmations from the app: its operation is evaluated again and runs
 * once. Answers what the operation answers: a read's result, or a write's result and entry (or its
 * acknowledgement). Another account's is not found; a conflict says when it expired or was already consumed.
 */
export const confirmContract = oc.input(pendingConfirmation).output(z.unknown());

/** Rejecting one of one's own pending confirmations from the app, with the same rules as confirming. */
export const rejectContract = oc.input(pendingConfirmation);

/**
 * The inputs of the platform's sensitive operations (ADR 0023), which run on the path of the actions as
 * `platform.<name>`: that name and this input are what a step-up proof is asked for.
 */
export const SENSITIVE_INPUTS = {
	setPermission: z.object({
		account: z.string().min(1),
		area: z.string().min(1),
		level: z.enum(["none", "read", "write", "manage"]),
	}),
	setDelegation: z.object({
		account: z.string().min(1),
		area: z.string().min(1),
		level: z.enum(["read", "write", "manage"]),
		value: z.enum(["no", "yes", "confirm"]),
	}),
	revokeSession: z.object({ session: z.string().min(1) }),
	revokeDevice: z.object({ session: z.string().min(1) }),
};

/**
 * What a write answers the first time, its result and the number of its entry in the action log, or, repeated
 * under the same key, an acknowledgement without content.
 */
function writeOutcome<TResult extends z.ZodType>(result: TResult) {
	return z.union([
		z.object({ result, entry: z.number().int() }),
		z.object({ entry: z.number().int(), repeated: z.literal(true) }),
	]);
}

/**
 * Asking for a step-up proof (GLOSSARY: comprobante): the current password and the exact operation it is for,
 * an action (`<module>.<action>`, or `platform.<name>` for one of {@link SENSITIVE_INPUTS}) with the input it
 * will run with, or the undo of an entry. The proof travels with that operation in the `step-up-proof` header
 * and is good once, for five minutes, from this session and device. A wrong password answers `FORBIDDEN`; no
 * error repeats it.
 */
export const requestProofContract = oc
	.errors({ FORBIDDEN: { data: z.object({ reason: z.literal("wrong-password") }) } })
	.input(
		z.object({
			password: z.string().min(1).max(PASSWORD_LENGTH.max),
			operation: z.union([
				z.object({ action: z.string().min(1), input: z.unknown().optional() }),
				z.object({ undo: z.number().int().positive() }),
			]),
		}),
	)
	.output(z.object({ proof: z.string(), expiresAt: z.number().int() }));

/** Changing an account's permission in an area: only the admin, on a member or the device account. */
export const setPermissionContract = oc
	.input(SENSITIVE_INPUTS.setPermission)
	.output(writeOutcome(SENSITIVE_INPUTS.setPermission));

/** Changing one level of an account's delegation: one's own, or the device account's as admin. */
export const setDelegationContract = oc
	.input(SENSITIVE_INPUTS.setDelegation)
	.output(writeOutcome(SENSITIVE_INPUTS.setDelegation));

/**
 * Revoking another session of one's own, or one of the device account as admin. The current one ends by
 * signing out. Its pending confirmations and proofs end with it.
 */
export const revokeSessionContract = oc
	.input(SENSITIVE_INPUTS.revokeSession)
	.output(writeOutcome(SENSITIVE_INPUTS.revokeSession));

/**
 * Revoking, as admin, the device a session of the device account is on: every session on it ends, whoever's,
 * and so do the pending confirmations and proofs born there.
 */
export const revokeDeviceContract = oc
	.input(SENSITIVE_INPUTS.revokeDevice)
	.output(writeOutcome(z.object({ endedSessions: z.number().int() })));

/**
 * The platform's operations. Each sensitive one (permissions, delegation, revoking sessions and devices) is a
 * write: it takes its idempotency key and its step-up proof in headers, and answers `STEP_UP_REQUIRED` (403)
 * without a proof that matches it.
 */
export const platformContract = {
	status: statusContract,
	password: { change: changePasswordContract },
	sessions: { list: listSessionsContract, revoke: revokeSessionContract },
	confirmations: { confirm: confirmContract, reject: rejectContract },
	proofs: { request: requestProofContract },
	permissions: { set: setPermissionContract },
	delegation: { set: setDelegationContract },
	devices: { revoke: revokeDeviceContract },
};

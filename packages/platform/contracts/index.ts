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

export const platformContract = {
	status: statusContract,
	password: { change: changePasswordContract },
	sessions: { list: listSessionsContract },
	confirmations: { confirm: confirmContract, reject: rejectContract },
};

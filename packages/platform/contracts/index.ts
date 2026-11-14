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

/** One's own sessions, newest first, with their device; never another account's, and never a token. */
export const listSessionsContract = oc.output(
	z.array(
		z.object({
			id: z.string(),
			/** The session this request comes with. */
			current: z.boolean(),
			createdAt: z.number().int(),
			expiresAt: z.number().int(),
			device: z.object({
				/** An opaque id, the same for every session on that device: never the device cookie. */
				id: z.string(),
				name: z.string().nullable(),
				createdAt: z.number().int(),
			}),
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

/** Reading an account's delegation: whose. */
export const READ_DELEGATION_INPUT = z.object({ account: z.string().min(1) });

/** How much one level of an area is delegated to Kira (GLOSSARY: delegación). */
const delegated = z.enum(["no", "yes", "confirm"]);

/**
 * Reading an account's delegation, a read of the platform's area: one's own, or the device account's as admin.
 * Each registered area with its three levels. Via Kira it needs that read delegated; a delegation that asks
 * answers `CONFIRMATION_REQUIRED`.
 */
export const readDelegationContract = oc
	.input(READ_DELEGATION_INPUT)
	.output(
		z.record(z.string(), z.object({ read: delegated, write: delegated, manage: delegated })),
	);

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
 * The annotation of one entry of the action log (GLOSSARY: registro de acciones): its number, the action by its
 * full name, who asked for it, when, the entry it undid and the one that undid it, and the records it touched.
 * Never its input or its inverse.
 */
export const logAnnotation = z.object({
	entry: z.number().int(),
	action: z.string(),
	actor: z.object({ account: z.string(), via: z.string().optional() }),
	at: z.number().int(),
	undoes: z.number().int().nullable(),
	undoneBy: z.number().int().nullable(),
	touched: z.array(z.object({ module: z.string(), type: z.string(), id: z.string() })),
});

/**
 * Reading the action log, a read of the platform's area: the annotations of the represented account's own
 * entries, in order. Via Kira it needs that read delegated; a delegation that asks answers
 * `CONFIRMATION_REQUIRED`.
 */
export const readLogContract = oc.output(z.array(logAnnotation));

/**
 * Undoing one of one's own entries by its number: its stored inverse runs with the whole authorization, so it
 * may answer `CONFIRMATION_REQUIRED` or `STEP_UP_REQUIRED`. Another account's entry is not found. A write: it
 * takes its idempotency key, and its step-up proof, in headers.
 */
export const undoContract = oc
	.input(z.object({ entry: z.number().int().positive() }))
	.output(writeOutcome(z.unknown()));

/** A local time of the house, `HH:MM`. */
const localTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "not a local HH:MM");

/** A scheduled task by its id. */
const scheduledTask = z.object({ task: z.string().min(1).max(64) });

/**
 * The inputs of the settings of the scheduled tasks (ADR 0025), `manage` writes of the platform's area that run
 * on the path of the actions as `platform.<name>`: that name and this input are what a step-up proof is asked
 * for. A time of null goes back to the task's default.
 */
export const TASK_INPUTS = {
	setTaskTime: scheduledTask.extend({ time: localTime.nullable() }),
	pauseTask: scheduledTask,
	resumeTask: scheduledTask,
	launchTask: scheduledTask,
};

/** How often a task runs: every day, or every week on a weekday, at a local time of the house. */
const frequency = z.union([
	z.object({ every: z.literal("day"), at: localTime }),
	z.object({
		every: z.literal("week"),
		on: z.enum(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]),
		at: localTime,
	}),
]);

/**
 * One scheduled task as the admin sees it, without personal data: its id, its effective frequency (with the time
 * the admin chose, else its default), whether it is paused, its next run, its last run with its result (null
 * while it runs; the error is an operator's message in English), and whether its job is stuck.
 */
export const scheduledTaskView = z.object({
	id: z.string(),
	frequency,
	paused: z.boolean(),
	nextAt: z.number().int(),
	lastRun: z
		.object({
			manual: z.boolean(),
			plannedAt: z.number().int(),
			startedAt: z.number().int().nullable(),
			finishedAt: z.number().int().nullable(),
			result: z.enum(["ok", "failed", "cancelled", "skipped"]).nullable(),
			error: z.string().nullable(),
		})
		.nullable(),
	stuck: z.boolean(),
});

/** Listing the scheduled tasks, a read of the platform's area without a proof: any account with `read` on it. */
export const listTasksContract = oc.output(z.array(scheduledTaskView));

/** Changing a task's time, or back to its default with null: undoable, it moves the next run from now. */
export const setTaskTimeContract = oc
	.input(TASK_INPUTS.setTaskTime)
	.output(writeOutcome(TASK_INPUTS.setTaskTime));

/** Pausing a task: it creates no run until it resumes. Undoable. */
export const pauseTaskContract = oc
	.input(TASK_INPUTS.pauseTask)
	.output(writeOutcome(scheduledTask.extend({ paused: z.literal(true) })));

/** Resuming a task, its next run from now, without catching up what it skipped. Undoable. */
export const resumeTaskContract = oc
	.input(TASK_INPUTS.resumeTask)
	.output(writeOutcome(scheduledTask.extend({ paused: z.literal(false) })));

/**
 * Launching a task now, a manual run of its own: irreversible. A task with a run pending or in progress answers
 * `CONFLICT` with the reason `task-busy`, and gets no other.
 */
export const launchTaskContract = oc
	.input(TASK_INPUTS.launchTask)
	.output(writeOutcome(scheduledTask.extend({ run: z.number().int() })));

/**
 * Asking for a test notice to oneself (ADR 0029, «El aviso de prueba»): an irreversible write with its key, only
 * from a person's session of the app, by itself, with no level of any area and no proof; the device account and
 * Kira answer `FORBIDDEN`. Its result names who it goes to: always who asks. Without an enabled subscription it
 * reaches nobody, and still answers well.
 */
export const testNoticeContract = oc.output(writeOutcome(z.object({ to: z.string() })));

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
	delegation: { read: readDelegationContract, set: setDelegationContract },
	devices: { revoke: revokeDeviceContract },
	log: { read: readLogContract, undo: undoContract },
	notifications: { test: testNoticeContract },
	tasks: {
		list: listTasksContract,
		setTime: setTaskTimeContract,
		pause: pauseTaskContract,
		resume: resumeTaskContract,
		launch: launchTaskContract,
	},
};

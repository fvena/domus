// The errors the path of the actions answers with (ADR 0022, ADR 0023), shared by its parts. None carries
// anything of the original failure, of a proof or of a password.
import { ORPCError } from "@orpc/server";

/** The reasons of a conflict the platform answers (ADR 0022, ADR 0023). */
type ConflictReason =
	| "key-reused"
	| "already-undone"
	| "changed-since"
	| "window-closed"
	| "confirmation-expired"
	| "confirmation-consumed"
	| "task-busy";

/** A conflict, with its reason in `data.reason`. */
export function conflict(reason: ConflictReason) {
	return new ORPCError("CONFLICT", { data: { reason } });
}

/** Why an entry cannot be undone (ADR 0022). */
type NotUndoableReason = "irreversible" | "expired";

/** An entry that cannot be undone, with its reason in `data.reason`, as a conflict carries its own. */
export function notUndoable(reason: NotUndoableReason) {
	return new ORPCError("UNPROCESSABLE_CONTENT", { data: { reason } });
}

/**
 * The operation is sensitive and the request brings no step-up proof of it, or one that does not match: another
 * operation, session or device, expired, already used, or one it does not need. Nothing of the proof leaves.
 */
export function stepUpRequired() {
	return new ORPCError("STEP_UP_REQUIRED", {
		status: 403,
		message: "this operation needs a step-up proof of it",
	});
}

/** Any unexpected failure: nothing of the original error, neither its message nor its stack, leaves. */
export function internalError() {
	return new ORPCError("INTERNAL_SERVER_ERROR");
}

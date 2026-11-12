// The platform's own operations on the path of the actions (ADR 0023): reading the action log, and those that
// `identity/operations.ts` defines, such as reading a delegation or the sensitive changes of permissions,
// delegation and sessions. Each one is registered as an action of the platform's area, so it goes through the
// same validation, authorization, delegation, confirmation and proofs as a module's.
import { PLATFORM_ID } from "@domus/module-sdk";
import type { AnySchema } from "@orpc/contract";

import type { ActionLog } from "../audit";
import type { SensitiveOperation, VerifiedContext } from "../authorization";
import type { RegisteredAction } from "./registry";

/** Reading the action log, by its full name: what a pending confirmation of it keeps. */
export const READ_LOG = `${PLATFORM_ID}.readLog`;

/** Reading an account's delegation, by its full name, one of the platform's operations. */
export const READ_DELEGATION = `${PLATFORM_ID}.readDelegation`;

/**
 * An operation of the platform (ADR 0023) on the path of the actions. A read of the platform's area, or a write
 * of it: with a key, logged without touched records and never undoable. A sensitive one is a write that needs a
 * step-up proof.
 */
export interface PlatformOperation {
	/** Its name after `platform.`. */
	readonly name: string;
	/** A write unless it says it is a read. */
	readonly kind?: "read" | "write";
	readonly sensitive?: SensitiveOperation;
	readonly inputSchema: AnySchema;
	/** The account whose settings or data it reads or changes, read inside its read or write. */
	readonly subject: (input: unknown, context: VerifiedContext) => string | undefined;
	/**
	 * For a write, on a new request and before authorization: throws `NOT_FOUND` when what its input names does
	 * not exist for who asks, so one out of reach answers as one that does not exist, whatever proof it brings.
	 * Not asked on a repeat, which answers its acknowledgement.
	 */
	readonly find?: (input: unknown, context: VerifiedContext) => void;
	/** Reads or changes it, once authorized; returns its result. */
	readonly run: (input: unknown, context: VerifiedContext) => unknown;
}

/** The platform's operations as registered actions, by their full name, reading the log among them. */
export function platformActions(
	operations: readonly PlatformOperation[],
	actionLog: ActionLog,
): ReadonlyMap<string, RegisteredAction> {
	const registered = new Map<string, RegisteredAction>();
	for (const operation of operations) {
		const kind = operation.kind ?? "write";
		registered.set(`${PLATFORM_ID}.${operation.name}`, {
			module: PLATFORM_ID,
			name: operation.name,
			kind,
			undoable: false,
			permission: { area: PLATFORM_ID, level: kind },
			inputSchema: operation.inputSchema,
			outputSchema: undefined,
			...(operation.sensitive === undefined ? {} : { sensitive: operation.sensitive }),
			subject: operation.subject,
			...(operation.find === undefined ? {} : { find: operation.find }),
			execute:
				kind === "read"
					? (context, input) => operation.run(input, context)
					: (context, input) => ({ result: operation.run(input, context), touched: [] }),
		});
	}
	// Reading the log, a read of the platform's area about one's own entries: on this path, so via Kira it goes
	// through the delegation, and a delegation that asks leaves it waiting as any other read.
	registered.set(READ_LOG, {
		module: PLATFORM_ID,
		name: "readLog",
		kind: "read",
		undoable: false,
		permission: { area: PLATFORM_ID, level: "read" },
		inputSchema: undefined,
		outputSchema: undefined,
		subject: (_input, context) => context.account,
		execute: (context) => actionLog.annotationsOf(context.account),
	});
	return registered;
}

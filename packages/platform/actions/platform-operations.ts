// The platform's own operations on the path of the actions (ADR 0023): reading the action log, and those that
// `identity/operations.ts` defines, such as reading a delegation or the sensitive changes of permissions,
// delegation and sessions, and the settings of the scheduled tasks of `background/operations.ts`. Each one is registered as an action of the platform's area, so it goes through the
// same validation, authorization, delegation, confirmation and proofs as a module's.
import { PLATFORM_ID } from "@domus/module-sdk";
import type { TouchedRecord } from "@domus/module-sdk";
import type { AnySchema } from "@orpc/contract";
import type { z } from "zod";

import type { ActionLog } from "../audit";
import type { SensitiveOperation, VerifiedContext } from "../authorization";
import type { RegisteredAction } from "./registry";

/** Reading the action log, by its full name: what a pending confirmation of it keeps. */
export const READ_LOG = `${PLATFORM_ID}.readLog`;

/** Reading an account's delegation, by its full name, one of the platform's operations. */
export const READ_DELEGATION = `${PLATFORM_ID}.readDelegation`;

/**
 * An operation of the platform (ADR 0023) on the path of the actions. A read of the platform's area, or a write
 * of it: with a key and logged with the records it declares it touches. A sensitive one, or one at level `manage`, is a write
 * that needs a step-up proof.
 */
export interface PlatformOperation {
	/** Its name after `platform.`. */
	readonly name: string;
	/** A write unless it says it is a read. */
	readonly kind?: "read" | "write";
	/** The level it asks for in the platform's area: its kind unless it says `manage`. */
	readonly level?: "manage";
	/**
	 * For a write: true when its `run` returns `{ result, inverse }`, the inverse a write of the platform whose
	 * input brings back what it changed. Never undoable unless it says so.
	 */
	readonly undoable?: boolean;
	readonly sensitive?: SensitiveOperation;
	/** One a person asks for themselves, with no level of any area (`personal` of authorization). */
	readonly personal?: true;
	/** Undefined for one that takes no input. */
	readonly inputSchema: AnySchema | undefined;
	/** The account whose settings or data it reads or changes, read inside its read or write. */
	readonly subject: (input: unknown, context: VerifiedContext) => string | undefined;
	/**
	 * For a write, on a new request and before authorization: throws `NOT_FOUND` when what its input names does
	 * not exist for who asks, so one out of reach answers as one that does not exist, whatever proof it brings.
	 * Not asked on a repeat, which answers its acknowledgement.
	 */
	readonly find?: (input: unknown, context: VerifiedContext) => void;
	/**
	 * For a write: the records it changes, logged with its entry, so a later write of the same record keeps an undo
	 * of it from overwriting that change (`changed-since`). None unless it says so.
	 */
	readonly touches?: (input: unknown) => readonly TouchedRecord[];
	/** Reads or changes it, once authorized; returns its result. */
	readonly run: (input: unknown, context: VerifiedContext) => unknown;
}

/** One operation with its input typed by its schema, which the path of the actions validates before either runs. */
interface TypedOperation<TSchema extends z.ZodType> extends Omit<
	PlatformOperation,
	"inputSchema" | "subject" | "find" | "touches" | "run"
> {
	readonly inputSchema: TSchema;
	readonly subject: (input: z.infer<TSchema>, context: VerifiedContext) => string | undefined;
	readonly find?: (input: z.infer<TSchema>, context: VerifiedContext) => void;
	readonly touches?: (input: z.infer<TSchema>) => readonly TouchedRecord[];
	readonly run: (input: z.infer<TSchema>, context: VerifiedContext) => unknown;
}

/** An operation as the path of the actions takes it, which hands each function only the input its schema accepted. */
export function platformOperation<TSchema extends z.ZodType>(
	typed: TypedOperation<TSchema>,
): PlatformOperation {
	return typed as unknown as PlatformOperation;
}

/** The platform's operations as registered actions, by their full name, reading the log among them. */
export function platformActions(
	operations: readonly PlatformOperation[],
	actionLog: ActionLog,
): ReadonlyMap<string, RegisteredAction> {
	const registered = new Map<string, RegisteredAction>();
	for (const operation of operations) {
		const kind = operation.kind ?? "write";
		const undoable = kind === "write" && operation.undoable === true;
		const touched = (input: unknown) => operation.touches?.(input) ?? [];
		registered.set(`${PLATFORM_ID}.${operation.name}`, {
			module: PLATFORM_ID,
			name: operation.name,
			kind,
			undoable,
			permission: { area: PLATFORM_ID, level: operation.level ?? kind },
			inputSchema: operation.inputSchema,
			outputSchema: undefined,
			...(operation.sensitive === undefined ? {} : { sensitive: operation.sensitive }),
			...(operation.personal === true ? { personal: true } : {}),
			subject: operation.subject,
			...(operation.find === undefined ? {} : { find: operation.find }),
			execute:
				kind === "read"
					? (context, input) => operation.run(input, context)
					: undoable
						? (context, input) => ({
								...(operation.run(input, context) as object),
								touched: touched(input),
							})
						: (context, input) => ({
								result: operation.run(input, context),
								touched: touched(input),
							}),
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

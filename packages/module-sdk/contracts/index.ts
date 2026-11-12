// How a module declares its actions in `contracts/` (ADR 0022). Pure: oRPC contracts and nothing else, so the
// browser, assistant and voice-gateway can import a module's contracts. It adds to oRPC only Domus's
// conventions, as metadata: whether the action reads or writes and, for a write, whether it can be undone.
// Input, output and errors are oRPC's, with zod.
import { type AnySchema, type ContractProcedure, type ErrorMap, oc } from "@orpc/contract";

/** The metadata of a read: it changes nothing, is not logged and takes no idempotency key. */
export interface ReadActionMeta {
	readonly kind: "read";
}

/**
 * The metadata of a write: it takes an idempotency key and is logged. When `undoable`, its handler must
 * return its inverse; when not, the caller knows before running it that it cannot be undone.
 */
export interface WriteActionMeta<TUndoable extends boolean = boolean> {
	readonly kind: "write";
	readonly undoable: TUndoable;
}

export type ActionMeta = ReadActionMeta | WriteActionMeta;

/** The contract of one action, as `readAction()`, `writeAction()` and their oRPC builder methods make it. */
export type ActionContract = ContractProcedure<AnySchema, AnySchema, ErrorMap, ActionMeta>;

/** The contract of a module: its actions by name. Each one is called `<module>.<action>`. */
export type ModuleContract = Readonly<Record<string, ActionContract>>;

/** Starts the contract of a read: chain `.input()`, `.output()` and `.errors()` as with oRPC's `oc`. */
export function readAction() {
	return oc.$meta<ReadActionMeta>({ kind: "read" });
}

/** Starts the contract of a write, saying whether it can be undone; then chain as with `readAction()`. */
export function writeAction<const TUndoable extends boolean>({
	undoable,
}: {
	readonly undoable: TUndoable;
}) {
	return oc.$meta<WriteActionMeta<TUndoable>>({ kind: "write", undoable });
}

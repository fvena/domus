// How a module declares its actions in `contracts/` (ADR 0022, ADR 0023). Pure: oRPC contracts and nothing else,
// so the browser, assistant and voice-gateway can import a module's contracts. It adds to oRPC only Domus's
// conventions, as metadata: whether the action reads or writes, for a write whether it can be undone, and the
// permission it asks for. Input, output and errors are oRPC's, with zod.
import { type AnySchema, type ContractProcedure, type ErrorMap, oc } from "@orpc/contract";

/** What an account may do in an area. Each level includes the ones before it. */
export type PermissionLevel = "read" | "write" | "manage";

/**
 * The permission an action asks for: a level in an area. The area defaults to the module's own, which has the
 * module's id; another one is `<module>.<name>`, declared in the module's `areas`.
 */
export interface ActionPermission<TLevel extends PermissionLevel = PermissionLevel> {
	readonly area?: string;
	readonly level: TLevel;
}

/** The metadata of a read: it changes nothing, is not logged and takes no idempotency key. */
export interface ReadActionMeta {
	readonly kind: "read";
	readonly permission: ActionPermission;
}

/**
 * The metadata of a write: it takes an idempotency key and is logged. When `undoable`, its handler must
 * return its inverse; when not, the caller knows before running it that it cannot be undone. A write never
 * asks only for `read`.
 */
export interface WriteActionMeta<TUndoable extends boolean = boolean> {
	readonly kind: "write";
	readonly undoable: TUndoable;
	readonly permission: ActionPermission<"write" | "manage">;
}

export type ActionMeta = ReadActionMeta | WriteActionMeta;

/** The contract of one action, as `readAction()`, `writeAction()` and their oRPC builder methods make it. */
export type ActionContract = ContractProcedure<AnySchema, AnySchema, ErrorMap, ActionMeta>;

/** The contract of a module: its actions by name. Each one is called `<module>.<action>`. */
export type ModuleContract = Readonly<Record<string, ActionContract>>;

/**
 * Starts the contract of a read with the permission it asks for, such as `readAction({ level: "read" })`;
 * then chain `.input()`, `.output()` and `.errors()` as with oRPC's `oc`.
 */
export function readAction({ area, level }: ActionPermission) {
	return oc.$meta<ReadActionMeta>({ kind: "read", permission: permissionOf(area, level) });
}

/**
 * Starts the contract of a write, saying whether it can be undone and the permission it asks for, such as
 * `writeAction({ undoable: true, level: "write" })`; then chain as with `readAction()`.
 */
export function writeAction<const TUndoable extends boolean>({
	undoable,
	area,
	level,
}: {
	readonly undoable: TUndoable;
} & ActionPermission<"write" | "manage">) {
	return oc.$meta<WriteActionMeta<TUndoable>>({
		kind: "write",
		undoable,
		permission: permissionOf(area, level),
	});
}

/** Leaves `area` out when the module's own is meant, so the metadata says only what was declared. */
function permissionOf<TLevel extends PermissionLevel>(
	area: string | undefined,
	level: TLevel,
): ActionPermission<TLevel> {
	return area === undefined ? { level } : { area, level };
}

// How a module declares its actions in `contracts/` (ADR 0022, ADR 0023). Pure: oRPC contracts and nothing else,
// so the browser, assistant and voice-gateway can import a module's contracts. It adds to oRPC only Domus's
// conventions, as metadata: whether the action reads or writes, for a write whether it can be undone, and the
// permission it asks for. Input, output and errors are oRPC's, with zod. `fileRef()` marks where a read's output
// holds a file, the only place a download may take one from (ADR 0028).
import { type AnySchema, type ContractProcedure, type ErrorMap, oc } from "@orpc/contract";
import { z } from "zod";

/** What an account may do in an area. Each level includes the ones before it. */
export type PermissionLevel = "read" | "write" | "manage";

/**
 * The permission an action asks for: a level in an area. The area defaults to the module's own, which has the
 * module's id; another one is `<module>.<name>`, declared in the module's `areas`.
 */
export interface ActionPermission<TLevel extends PermissionLevel = PermissionLevel> {
	readonly area?: string;
	readonly level: TLevel;
	/**
	 * The action asks the person to confirm it every time, whoever asks, before it runs: a pending
	 * confirmation (ADR 0023). Only once, even when the delegation asks too.
	 */
	readonly alwaysConfirm?: boolean;
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
export function readAction(permission: ActionPermission) {
	return oc.$meta<ReadActionMeta>({ kind: "read", permission: permissionOf(permission) });
}

/**
 * Starts the contract of a write, saying whether it can be undone and the permission it asks for, such as
 * `writeAction({ undoable: true, level: "write" })`; then chain as with `readAction()`.
 */
export function writeAction<const TUndoable extends boolean>({
	undoable,
	...permission
}: {
	readonly undoable: TUndoable;
} & ActionPermission<"write" | "manage">) {
	return oc.$meta<WriteActionMeta<TUndoable>>({
		kind: "write",
		undoable,
		permission: permissionOf(permission),
	});
}

/**
 * Leaves `area` out when the module's own is meant, and `alwaysConfirm` when it is not asked, so the metadata
 * says only what was declared.
 */
function permissionOf<TLevel extends PermissionLevel>({
	area,
	level,
	alwaysConfirm,
}: ActionPermission<TLevel>): ActionPermission<TLevel> {
	return {
		...(area === undefined ? {} : { area }),
		level,
		...(alwaysConfirm === true ? { alwaysConfirm } : {}),
	};
}

/** The key of the mark `fileRef()` leaves in the metadata of Zod's global registry. */
const FILE_REF_MARK = "domusFileRef";

/**
 * A file of a record in an action's output (ADR 0028): its reference's opaque id, never the content's hash, the
 * name its uploader gave it, the type detected from its bytes and its size in bytes. Marked in its metadata, so
 * the platform finds every position of a read's output that holds one, inside arrays, optional and nullable
 * values too: a download serves only a file the read returned there.
 */
export function fileRef() {
	return z
		.object({
			id: z.string().min(1),
			name: z.string().min(1),
			type: z.string().min(1),
			size: z.number().int().nonnegative(),
		})
		.meta({ [FILE_REF_MARK]: true });
}

/** A file of a record, as `fileRef()` describes it. */
export type FileRef = z.output<ReturnType<typeof fileRef>>;

/** True for a schema `fileRef()` made, or a clone of one that keeps its metadata. */
export function isFileRef(schema: unknown): boolean {
	if (!(schema instanceof z.ZodType)) return false;
	return z.globalRegistry.get(schema)?.[FILE_REF_MARK] === true;
}

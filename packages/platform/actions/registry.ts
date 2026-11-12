// What the path of the actions keeps of each operation it runs, a module's action or one of the platform's own,
// read once at registration.
import type { AnySchema } from "@orpc/contract";

import type { RequiredPermission, SensitiveOperation, VerifiedContext } from "../authorization";

/** One action as its contract declared it, read once at registration. */
export interface RegisteredAction {
	readonly module: string;
	/** Its name inside its module. */
	readonly name: string;
	readonly kind: "read" | "write";
	/** Only a write can be undoable. */
	readonly undoable: boolean;
	/** What its contract asks for, with the module's own area when it names none. */
	readonly permission: RequiredPermission;
	readonly inputSchema: AnySchema | undefined;
	/** Checks a read's result, or a write's result inside what `execute` returns. */
	readonly outputSchema: AnySchema | undefined;
	/** For a sensitive operation of the platform: which one. */
	readonly sensitive?: SensitiveOperation;
	/** For an operation of the platform on one account's own settings or data: that account. */
	readonly subject?: (input: unknown, context: VerifiedContext) => string | undefined;
	/** For a write of the platform: what its input names must exist for who asks, else `NOT_FOUND`. */
	readonly find?: (input: unknown, context: VerifiedContext) => void;
	/** Runs it with its validated input, and returns what a module's handler would. */
	readonly execute: (context: VerifiedContext, input: unknown, now: number) => unknown;
}

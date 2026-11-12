// What only test-utils takes from platform (ADR 0021, ADR 0022): the Drizzle client of a module, behind dbFor,
// a platform with an authorizer and a clock the test chooses, the way to invoke its actions and undo their
// entries, and a read of its action log. A rule of .dependency-cruiser.cjs keeps every other importer out; the
// main entry offers none of it.
import type { ActionCall, UndoCall, WriteOutcome } from "../actions";
import type { LogEntry } from "../audit";
import { actionLogOf, actionsOf, type Platform } from "../platform";

export type { Acknowledgement, WriteOutcome, WriteReceipt } from "../actions";
export type { LogEntry } from "../audit";
export type { Authorizer, Decision } from "../authorization";
export { type ModuleDatabase, moduleDatabase } from "./module-database";

/** A platform like createPlatform's, but with the authorizer and clock of its runtime. */
export { openPlatform as createPlatformWith } from "../platform";

/** Runs an action through the platform's one path: validation, authorization, handler, result and, for a write, its log entry. */
export function invokeAction(platform: Platform, call: ActionCall): unknown {
	return actionsOf(platform).invoke(call);
}

/** Undoes an entry through the platform's one path: its stored inverse, the checks and one new log entry. */
export function undoEntry(platform: Platform, call: UndoCall): WriteOutcome {
	return actionsOf(platform).undo(call);
}

/** Every entry of the action log, in order, with its content even when expired. A copy: changing it changes nothing. */
export function readLog(platform: Platform): readonly LogEntry[] {
	return actionLogOf(platform).entries();
}

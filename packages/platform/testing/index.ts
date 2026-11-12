// What only test-utils takes from platform (ADR 0021, ADR 0022): the Drizzle client of a module, behind dbFor,
// a platform with an authorizer and a clock the test chooses, the way to invoke its actions and a read of its
// action log. A rule of .dependency-cruiser.cjs keeps every other importer out; the main entry offers none of it.
import type { ActionCall } from "../actions";
import type { LogEntry } from "../audit";
import {
	actionsOf,
	auditOf,
	openPlatform,
	type Platform,
	type PlatformOptions,
	type PlatformRuntime,
} from "../platform";

export type { ActionCall, Clock, WriteReceipt } from "../actions";
export type { LogEntry, LoggedRecord } from "../audit";
export type { AuthorizationRequest, Authorizer, Decision } from "../authorization";
export type { PlatformRuntime } from "../platform";
export { type ModuleDatabase, moduleDatabase } from "./module-database";

/** A platform like createPlatform's, but with the authorizer and clock of `runtime`. */
export function createPlatformWith(options: PlatformOptions, runtime: PlatformRuntime): Platform {
	return openPlatform(options, runtime);
}

/** Runs an action through the platform's one path: validation, authorization, handler, result and, for a write, its log entry. */
export function invokeAction(platform: Platform, call: ActionCall): unknown {
	return actionsOf(platform).invoke(call);
}

/** Every entry of the action log, in order, with its content even when expired. A copy: changing it changes nothing. */
export function readLog(platform: Platform): readonly LogEntry[] {
	return auditOf(platform).entries();
}

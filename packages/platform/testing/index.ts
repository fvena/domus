// What only test-utils takes from platform (ADR 0021, ADR 0022): the Drizzle client of a module, behind dbFor,
// and a platform with an authorizer and a clock the test chooses, with the way to invoke its actions. A rule of
// .dependency-cruiser.cjs keeps every other importer out; the main entry offers none of it.
import type { ActionCall } from "../actions";
import {
	actionsOf,
	openPlatform,
	type Platform,
	type PlatformOptions,
	type PlatformRuntime,
} from "../platform";

export type { ActionCall, Clock } from "../actions";
export type { AuthorizationRequest, Authorizer, Decision } from "../authorization";
export type { PlatformRuntime } from "../platform";
export { type ModuleDatabase, moduleDatabase } from "./module-database";

/** A platform like createPlatform's, but with the authorizer and clock of `runtime`. */
export function createPlatformWith(options: PlatformOptions, runtime: PlatformRuntime): Platform {
	return openPlatform(options, runtime);
}

/** Runs an action through the platform's one path: validation, authorization, handler, result. */
export function invokeAction(platform: Platform, call: ActionCall): unknown {
	return actionsOf(platform).invoke(call);
}

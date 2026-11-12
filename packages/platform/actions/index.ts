// The one path every action takes, whoever asks (ADR 0022): find it, validate its input, ask authorization,
// run its handler and validate its result. Phase 1b's first step brings reads: they run with
// `PRAGMA query_only` on, take no idempotency key and log nothing.
import { isDeepStrictEqual } from "node:util";

import type { Actor, ModuleDatabase, ModuleDefinition, ModuleSchema } from "@domus/module-sdk";
import type { ActionContract } from "@domus/module-sdk/contracts";
import type { AnySchema } from "@orpc/contract";
import { ORPCError } from "@orpc/server";
import type Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

import { type Authorizer, isAllowed } from "../authorization";

/** The platform clock: instants in milliseconds since the epoch (ADR 0021). */
export type Clock = () => number;

/** One invocation: who asks, the action's full name (`<module>.<action>`) and its input. */
export interface ActionCall {
	readonly actor: Actor;
	readonly action: string;
	readonly input?: unknown;
}

export interface Actions {
	/** Runs an action, or throws one of the platform's errors. Synchronous, like the handlers. */
	invoke(call: ActionCall): unknown;
}

export interface ActionsOptions {
	readonly connection: Database.Database;
	readonly modules: readonly ModuleDefinition[];
	readonly authorizer: Authorizer;
	readonly clock: Clock;
}

interface RegisteredAction {
	readonly contract: ActionContract;
	readonly handler: (context: {
		input: unknown;
		db: ModuleDatabase<ModuleSchema>;
		actor: Actor;
		now: number;
	}) => unknown;
	readonly db: ModuleDatabase<ModuleSchema>;
}

/** The actions of `modules`, which `checkModules` has already accepted, on one connection. */
export function createActions({ connection, modules, authorizer, clock }: ActionsOptions): Actions {
	const registry = new Map<string, RegisteredAction>();
	for (const module of modules) {
		const db = drizzle({ client: connection, schema: module.schema });
		for (const [name, contract] of Object.entries(module.contract ?? {})) {
			const handler = module.actions?.[name];
			if (handler) registry.set(`${module.id}.${name}`, { contract, handler, db });
		}
	}

	return {
		invoke({ actor, action, input }) {
			const found = registry.get(action);
			if (!found) throw new ORPCError("NOT_FOUND", { message: `no action "${action}"` });
			const { inputSchema, outputSchema } = found.contract["~orpc"];

			const validated = validate(inputSchema, input);
			if (!validated.ok || !isLosslessJson(validated.value))
				throw new ORPCError("BAD_REQUEST", {
					message: "invalid input",
					data: { issues: validated.ok ? [] : validated.issues },
				});

			if (!isAllowed(authorizer, { actor, action, input: validated.value }))
				throw new ORPCError("FORBIDDEN");

			let result: unknown;
			connection.pragma("query_only = ON");
			try {
				result = found.handler({
					input: validated.value,
					db: found.db,
					actor,
					now: clock(),
				});
			} catch {
				throw internalError();
			} finally {
				connection.pragma("query_only = OFF");
			}

			const output = validate(outputSchema, result);
			if (!output.ok) throw internalError();
			return output.value;
		},
	};
}

/** Any unexpected failure: nothing of the original error, neither its message nor its stack, leaves. */
function internalError() {
	return new ORPCError("INTERNAL_SERVER_ERROR");
}

type Validation =
	| { readonly ok: true; readonly value: unknown }
	| { readonly ok: false; readonly issues: readonly Issue[] };

interface Issue {
	readonly message: string;
	readonly path: readonly PropertyKey[];
}

/** Validates synchronously with a contract's schema; no schema lets the value through. */
function validate(schema: AnySchema | undefined, value: unknown): Validation {
	if (!schema) return { ok: true, value };
	const result = schema["~standard"].validate(value);
	if (result instanceof Promise) throw internalError();
	if (!result.issues) return { ok: true, value: result.value };
	return {
		ok: false,
		issues: result.issues.map((issue) => ({
			message: issue.message,
			path: (issue.path ?? []).map((segment) =>
				typeof segment === "object" ? segment.key : segment,
			),
		})),
	};
}

/**
 * True when the value survives JSON unchanged: plain objects, arrays, strings, finite numbers, booleans and
 * `null`. `undefined` alone stands for an action without input.
 */
function isLosslessJson(value: unknown): boolean {
	if (value === undefined) return true;
	try {
		return isDeepStrictEqual(JSON.parse(JSON.stringify(value) ?? "null"), value);
	} catch {
		// A bigint or a cycle, which JSON cannot hold.
		return false;
	}
}

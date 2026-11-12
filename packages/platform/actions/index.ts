// The one path every action takes, whoever asks (ADR 0022): find it, validate its input, ask authorization,
// run its handler and validate its result. A read runs with `PRAGMA query_only` on, takes no idempotency key
// and logs nothing. A write needs a key and runs in one better-sqlite3 transaction that this path opens and
// commits: its handler, the checks of its result and inverse, and its entry in the action log. Any failure
// inside rolls back both the change and the entry. An undo takes the same path with the inverse its entry
// stored: one transaction for the checks, the inverse, its one new entry and the undone-by link.
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import type {
	ActionHandler,
	Actor,
	Inverse,
	ModuleDatabase,
	ModuleDefinition,
	ModuleSchema,
	TouchedRecord,
} from "@domus/module-sdk";
import type { ActionContract } from "@domus/module-sdk/contracts";
import type { AnySchema } from "@orpc/contract";
import { createORPCErrorConstructorMap, ORPCError } from "@orpc/server";
import type Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

import type { Audit, NumberedEntry } from "../audit";
import { type AuthorizationRequest, type Authorizer, isAllowed } from "../authorization";

/** The platform clock: instants in milliseconds since the epoch (ADR 0021). */
export type Clock = () => number;

/** One invocation: who asks, the action's full name (`<module>.<action>`), its input and, for a write, its key. */
export interface ActionCall {
	readonly actor: Actor;
	readonly action: string;
	readonly input?: unknown;
	/** The idempotency key the caller gives a write. A read takes none. */
	readonly key?: string;
}

/** What a write returns: its result and the number of its entry in the action log. Never its inverse. */
export interface WriteReceipt {
	readonly result: unknown;
	readonly entry: number;
}

export interface Actions {
	/**
	 * Runs an action, or throws one of the platform's errors or one its contract declares. A read returns its
	 * result; a write, a {@link WriteReceipt}. Synchronous, like the handlers.
	 */
	invoke(call: ActionCall): unknown;
	/**
	 * Undoes an entry with the inverse its write stored, never one the caller brings. Returns the inverse's
	 * result and its one new entry, linked to the entry it undoes. Throws like a write, or a conflict or a
	 * "cannot be undone" with its reason.
	 */
	undo(call: UndoCall): WriteReceipt;
}

/** An undo: who asks, the number of the entry to undo and the caller's own idempotency key. */
export interface UndoCall {
	readonly actor: Actor;
	readonly entry: number;
	readonly key: string;
}

export interface ActionsOptions {
	readonly connection: Database.Database;
	readonly modules: readonly ModuleDefinition[];
	readonly authorizer: Authorizer;
	readonly clock: Clock;
	readonly audit: Audit;
	/** How long the content of a new entry (input, result, inverse) stays usable, in milliseconds. */
	readonly retention: number;
}

interface RegisteredAction {
	readonly module: string;
	readonly name: string;
	readonly contract: ActionContract;
	readonly handler: ActionHandler<ActionContract, ModuleSchema>;
	readonly db: ModuleDatabase<ModuleSchema>;
}

/** The actions of `modules`, which `checkModules` has already accepted, on one connection. */
export function createActions({
	connection,
	modules,
	authorizer,
	clock,
	audit,
	retention,
}: ActionsOptions): Actions {
	const registry = new Map<string, RegisteredAction>();
	for (const module of modules) {
		const db = drizzle({ client: connection, schema: module.schema });
		for (const [name, contract] of Object.entries(module.contract ?? {})) {
			const handler = module.actions?.[name];
			if (handler)
				registry.set(`${module.id}.${name}`, {
					module: module.id,
					name,
					contract,
					handler,
					db,
				});
		}
	}

	/** Runs a handler; only an error its contract declares leaves as it is. */
	function run(found: RegisteredAction, actor: Actor, input: unknown, now: number): unknown {
		const { errorMap } = found.contract["~orpc"];
		try {
			return found.handler({
				input,
				db: found.db,
				actor,
				now,
				errors: createORPCErrorConstructorMap(errorMap),
			});
		} catch (error) {
			if (error instanceof ORPCError && error.defined && errorMap[error.code] !== undefined)
				throw error;
			throw internalError();
		}
	}

	function read(found: RegisteredAction, actor: Actor, action: string, input: unknown): unknown {
		if (!isAllowed(authorizer, { actor, action, input })) throw new ORPCError("FORBIDDEN");

		let result: unknown;
		connection.pragma("query_only = ON");
		try {
			result = run(found, actor, input, clock());
		} finally {
			connection.pragma("query_only = OFF");
		}

		const output = validate(found.contract["~orpc"].outputSchema, result);
		if (!output.ok) throw internalError();
		return output.value;
	}

	function write(
		found: RegisteredAction,
		actor: Actor,
		action: string,
		input: unknown,
		key: string | undefined,
	): WriteReceipt {
		const print = fingerprint(action, input);
		const request: AuthorizationRequest = { actor, action, input };

		return once(actor, key, print, request, (fresh) => {
			if (!isAllowed(authorizer, request)) throw new ORPCError("FORBIDDEN");
			return perform(found, actor, input, { key: fresh, fingerprint: print });
		});
	}

	function undo({ actor, entry: number, key }: UndoCall): WriteReceipt {
		const print = undoFingerprint(number);

		/** The inverse's request to authorization, with the context of the entry it undoes. */
		const requestFor = (original: NumberedEntry, inverse: Inverse): AuthorizationRequest => ({
			actor,
			action: inverse.action,
			input: inverse.input,
			undoes: { entry: original.entry, action: original.action, actor: original.actor },
		});

		return once(
			actor,
			key,
			print,
			() => {
				// A repeated undo: the entry it undid and that entry's inverse are in the log. The inverse only
				// builds the request to authorize anew, even when expired: it is neither returned nor run.
				const original = audit.find(number);
				if (!original?.inverse) throw internalError();
				return requestFor(original, original.inverse);
			},
			(fresh) => {
				const original = audit.find(number);
				if (!original) throw new ORPCError("NOT_FOUND", { message: `no entry ${number}` });
				if (original.undoneBy !== null) throw conflict("already-undone");
				if (!original.inverse) throw notUndoable("irreversible");
				if (isExpired(original.expiresAt)) throw notUndoable("expired");
				if (audit.touchedLater(number)) throw conflict("changed-since");
				if (!isAllowed(authorizer, requestFor(original, original.inverse)))
					throw new ORPCError("FORBIDDEN");

				// The inverse runs inside this operation, with its checks and its module's rules, without another
				// idempotent operation or another transaction.
				const inverse = checkInverse(original.module, original.inverse);
				const target = registry.get(inverse.action);
				if (!target) throw internalError();
				const receipt = perform(target, actor, inverse.input, {
					key: fresh,
					fingerprint: print,
					undoes: number,
				});
				audit.markUndone(number, receipt.entry);
				return receipt;
			},
		);
	}

	/**
	 * One idempotent operation under `key`, a write or an undo. Looking the key up, running and logging stay in
	 * one synchronous section of one transaction, so no other operation with the same key can slip in between.
	 * The same key under another fingerprint is a conflict. Under the same one, `repeated` is authorized anew
	 * and the stored result and entry come back without running anything. A new key goes to `fresh`, which
	 * authorizes, runs and logs.
	 */
	function once(
		actor: Actor,
		key: string | undefined,
		print: string,
		repeated: AuthorizationRequest | (() => AuthorizationRequest),
		fresh: (key: string) => WriteReceipt,
	): WriteReceipt {
		if (typeof key !== "string" || key === "")
			throw new ORPCError("BAD_REQUEST", { message: "a write needs an idempotency key" });

		const transaction = connection.transaction((): WriteReceipt => {
			const earlier = audit.findByKey(actor, key);
			if (!earlier) return fresh(key);
			if (earlier.fingerprint !== print) throw conflict("key-reused");
			const request = typeof repeated === "function" ? repeated() : repeated;
			if (!isAllowed(authorizer, request)) throw new ORPCError("FORBIDDEN");
			// An expired result is never returned, and the operation never runs again under the same key.
			if (isExpired(earlier.expiresAt)) throw conflict("result-expired");
			return { result: earlier.result, entry: earlier.entry };
		});

		try {
			return transaction();
		} catch (error) {
			// The platform's errors and those a contract declares, already sorted by run; anything else, such as
			// a failure writing the log, leaves without detail.
			if (error instanceof ORPCError) throw error;
			throw internalError();
		}
	}

	/** True from `expiresAt` on, by the platform clock: the content of that entry is no longer used. */
	function isExpired(expiresAt: number): boolean {
		return clock() >= expiresAt;
	}

	/** Runs an authorized write's handler, checks what it returned and logs its entry. */
	function perform(
		found: RegisteredAction,
		actor: Actor,
		input: unknown,
		log: { readonly key: string; readonly fingerprint: string; readonly undoes?: number },
	): WriteReceipt {
		const now = clock();
		const outcome = checkOutcome(found, run(found, actor, input, now));
		const entry = audit.record({
			module: found.module,
			action: found.name,
			actor,
			key: log.key,
			fingerprint: log.fingerprint,
			at: now,
			expiresAt: now + retention,
			input,
			result: outcome.result,
			inverse: outcome.inverse,
			touched: outcome.touched,
			undoes: log.undoes,
		});
		return { result: outcome.result, entry };
	}

	/** A write's outcome as its contract and the log need it, or an internal error that rolls it back. */
	function checkOutcome(
		found: RegisteredAction,
		outcome: unknown,
	): { result: unknown; touched: readonly TouchedRecord[]; inverse: Inverse | undefined } {
		if (typeof outcome !== "object" || outcome === null) throw internalError();
		const { result, touched, inverse } = outcome as Record<string, unknown>;

		if (!Array.isArray(touched) || !touched.every(isTouchedRecord)) throw internalError();

		const output = validate(found.contract["~orpc"].outputSchema, result);
		if (!output.ok || !isLosslessJson(output.value)) throw internalError();

		const meta = found.contract["~orpc"].meta;
		const undoable = meta.kind === "write" && meta.undoable;
		return {
			result: output.value,
			touched,
			inverse: undoable ? checkInverse(found.module, inverse) : undefined,
		};
	}

	/** A valid inverse names a write of the same module, and its input passes that write's contract. */
	function checkInverse(module: string, inverse: unknown): Inverse {
		if (typeof inverse !== "object" || inverse === null) throw internalError();
		const { action, input } = inverse as Record<string, unknown>;
		const target = typeof action === "string" ? registry.get(action) : undefined;
		if (
			typeof action !== "string" ||
			!target ||
			target.module !== module ||
			target.contract["~orpc"].meta.kind !== "write"
		)
			throw internalError();

		const validated = validate(target.contract["~orpc"].inputSchema, input);
		if (!validated.ok || !isLosslessJson(validated.value)) throw internalError();
		return { action, input: validated.value };
	}

	return {
		invoke({ actor, action, input, key }) {
			const found = registry.get(action);
			if (!found) throw new ORPCError("NOT_FOUND", { message: `no action "${action}"` });

			const validated = validate(found.contract["~orpc"].inputSchema, input);
			if (!validated.ok || !isLosslessJson(validated.value))
				throw new ORPCError("BAD_REQUEST", {
					message: "invalid input",
					data: { issues: validated.ok ? [] : validated.issues },
				});

			return found.contract["~orpc"].meta.kind === "write"
				? write(found, actor, action, validated.value, key)
				: read(found, actor, action, validated.value);
		},
		undo,
	};
}

/** The reasons of a conflict the platform answers (ADR 0022). */
type ConflictReason = "key-reused" | "already-undone" | "changed-since" | "result-expired";

/** A conflict, with its reason in `data.reason`. */
function conflict(reason: ConflictReason) {
	return new ORPCError("CONFLICT", { data: { reason } });
}

/** Why an entry cannot be undone (ADR 0022). */
type NotUndoableReason = "irreversible" | "expired";

/** An entry that cannot be undone, with its reason in `data.reason`, as a conflict carries its own. */
function notUndoable(reason: NotUndoableReason) {
	return new ORPCError("UNPROCESSABLE_CONTENT", { data: { reason } });
}

/** Any unexpected failure: nothing of the original error, neither its message nor its stack, leaves. */
function internalError() {
	return new ORPCError("INTERNAL_SERVER_ERROR");
}

function isTouchedRecord(value: unknown): value is TouchedRecord {
	if (typeof value !== "object" || value === null) return false;
	const { type, id } = value as Record<string, unknown>;
	return (
		typeof type === "string" &&
		type !== "" &&
		(typeof id === "string" || (typeof id === "number" && Number.isFinite(id)))
	);
}

/**
 * The fingerprint of an undo: the operation and the entry's number. It never equals a write's, whose action
 * name always holds a dot, so the inverse invoked directly with an undo's key is another request.
 */
function undoFingerprint(entry: number): string {
	return `undo:${entry}`;
}

/**
 * The fingerprint of a write: its full name and the SHA-256 of its validated input as canonical JSON (keys
 * sorted), so the order of the properties does not change it.
 */
function fingerprint(action: string, input: unknown): string {
	const hash = createHash("sha256")
		.update(JSON.stringify(canonical(input)) ?? "")
		.digest("hex");
	return `${action}:${hash}`;
}

function canonical(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonical);
	if (typeof value !== "object" || value === null) return value;
	return Object.fromEntries(
		Object.keys(value)
			.sort()
			.map((key) => [key, canonical((value as Record<string, unknown>)[key])]),
	);
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
 * `null`. `undefined` alone stands for an action without input or result.
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

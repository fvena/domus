// The one path every action takes, whoever asks (ADR 0022): find it, validate its input, ask authorization,
// run its handler and validate its result. A read runs with `PRAGMA query_only` on, takes no idempotency key
// and logs nothing. A write needs a key and runs in one better-sqlite3 transaction that this path opens and
// commits: its handler, the checks of its result and inverse, and its entry in the action log. Any failure
// inside rolls back both the change and the entry. An undo takes the same path with the inverse its entry
// stored: one transaction for the checks, the inverse, its one new entry and the undone-by link. Neither keeps
// its result: repeating one under the same key answers an acknowledgement without content (ADR 0023).
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
import type { AnySchema, ErrorMap } from "@orpc/contract";
import { createORPCErrorConstructorMap, ORPCError } from "@orpc/server";
import type Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

import type { ActionLog, NumberedEntry } from "../audit";
import { type AuthorizationRequest, type Authorizer, isAllowed } from "../authorization";

/** The platform clock: instants in milliseconds since the epoch (ADR 0021). */
export type Clock = () => number;

/** One invocation: who asks, the action's full name (`<module>.<action>`), its input and, for a write, its key. */
export interface ActionCall {
	readonly actor: Actor;
	readonly action: string;
	readonly input?: unknown;
	/** The idempotency key the caller gives a write. A read takes none. */
	readonly idempotencyKey?: string;
}

/** What a write returns the first time: its result and the number of its entry in the action log. Never its inverse. */
export interface WriteReceipt {
	readonly result: unknown;
	readonly entry: number;
}

/**
 * What a repeated write or undo returns: the number of the entry the first time logged, without content
 * (ADR 0023). The same once its content expired or its entry was undone.
 */
export interface Acknowledgement {
	readonly entry: number;
	readonly repeated: true;
}

/** What a write or an undo returns: a receipt the first time, an acknowledgement when repeated. */
export type WriteOutcome = WriteReceipt | Acknowledgement;

export interface Actions {
	/**
	 * Runs an action, or throws one of the platform's errors or one its contract declares. A read returns its
	 * result; a write, a {@link WriteOutcome}. Synchronous, like the handlers.
	 */
	invoke(call: ActionCall): unknown;
	/**
	 * Undoes an entry with the inverse its write stored, never one the caller brings. Returns the inverse's
	 * result and its one new entry, linked to the entry it undoes, or an acknowledgement when repeated. Throws
	 * like a write, or a conflict or a "cannot be undone" with its reason.
	 */
	undo(call: UndoCall): WriteOutcome;
}

/** An undo: who asks, the number of the entry to undo and the caller's own idempotency key. */
export interface UndoCall {
	readonly actor: Actor;
	readonly entry: number;
	readonly idempotencyKey: string;
}

export interface ActionsOptions {
	readonly connection: Database.Database;
	readonly modules: readonly ModuleDefinition[];
	readonly authorizer: Authorizer;
	readonly clock: Clock;
	readonly actionLog: ActionLog;
	/** How long the content of a new entry (input, inverse) stays usable, in milliseconds. */
	readonly retention: number;
}

/** One action as its contract declared it, read once at registration. */
interface RegisteredAction {
	readonly module: string;
	/** Its name inside its module. */
	readonly name: string;
	readonly kind: "read" | "write";
	/** Only a write can be undoable. */
	readonly undoable: boolean;
	readonly inputSchema: AnySchema | undefined;
	readonly outputSchema: AnySchema | undefined;
	/** The errors its contract declares: the only ones its handler's throws leave with. */
	readonly errorMap: ErrorMap;
	readonly handler: ActionHandler<ActionContract, ModuleSchema>;
	readonly db: ModuleDatabase<ModuleSchema>;
}

/** The actions of `modules`, which `checkModules` has already accepted, on one connection. */
export function createActions({
	connection,
	modules,
	authorizer,
	clock,
	actionLog,
	retention,
}: ActionsOptions): Actions {
	const registry = new Map<string, RegisteredAction>();
	for (const module of modules) {
		const db = drizzle({ client: connection, schema: module.schema });
		for (const [name, contract] of Object.entries(module.contract ?? {})) {
			const handler = module.actions?.[name];
			if (!handler) continue;
			const { meta, inputSchema, outputSchema, errorMap } = contract["~orpc"];
			registry.set(`${module.id}.${name}`, {
				module: module.id,
				name,
				kind: meta.kind,
				undoable: meta.kind === "write" && meta.undoable,
				inputSchema,
				outputSchema,
				errorMap,
				handler,
				db,
			});
		}
	}

	return {
		invoke: (call) => guarded(() => invoke(call)),
		undo: (call) => guarded(() => undo(call)),
	};

	function invoke({ actor, action, input, idempotencyKey }: ActionCall): unknown {
		const found = registry.get(action);
		if (!found) throw new ORPCError("NOT_FOUND", { message: `no action "${action}"` });

		const validated = validate(found.inputSchema, input);
		if (!validated.ok || !isLosslessJson(validated.value))
			throw new ORPCError("BAD_REQUEST", {
				message: "invalid input",
				data: { issues: validated.ok ? [] : validated.issues },
			});

		return found.kind === "write"
			? write(found, actor, action, validated.value, idempotencyKey)
			: read(found, actor, action, validated.value);
	}

	/** Asks authorization, which fails closed: anything but an explicit "allow" ends forbidden. */
	function authorize(request: AuthorizationRequest): void {
		if (!isAllowed(authorizer, request)) throw new ORPCError("FORBIDDEN");
	}

	/** Runs a handler; only an error its contract declares leaves as it is. */
	function run(found: RegisteredAction, actor: Actor, input: unknown, now: number): unknown {
		let outcome: unknown;
		try {
			outcome = found.handler({
				input,
				db: found.db,
				actor,
				now,
				errors: createORPCErrorConstructorMap(found.errorMap),
			});
		} catch (error) {
			throw declaredOrInternal(found, error);
		}
		// An async handler, which its type forbids: what it would do later falls outside the transaction.
		if (isThenable(outcome)) {
			settleQuietly(outcome);
			throw internalError();
		}
		return outcome;
	}

	function read(found: RegisteredAction, actor: Actor, action: string, input: unknown): unknown {
		authorize({ actor, action, input });

		let result: unknown;
		connection.pragma("query_only = ON");
		try {
			result = run(found, actor, input, clock());
		} finally {
			connection.pragma("query_only = OFF");
		}

		const output = validate(found.outputSchema, result);
		if (!output.ok) throw internalError();
		return output.value;
	}

	function write(
		found: RegisteredAction,
		actor: Actor,
		action: string,
		input: unknown,
		idempotencyKey: string | undefined,
	): WriteOutcome {
		const fingerprint = writeFingerprint(action, input);
		const request: AuthorizationRequest = { actor, action, input };

		return once(
			actor,
			idempotencyKey,
			fingerprint,
			() => request,
			(key) => {
				authorize(request);
				return perform(found, actor, input, { idempotencyKey: key, fingerprint });
			},
		);
	}

	function undo({ actor, entry: number, idempotencyKey }: UndoCall): WriteOutcome {
		const fingerprint = undoFingerprint(number);

		/** The request to authorization for an inverse, with the context of the entry it undoes. */
		const requestFor = (original: NumberedEntry, inverse: Inverse): AuthorizationRequest => ({
			actor,
			action: inverse.action,
			input: inverse.input,
			undoes: { entry: original.entry, action: original.action, actor: original.actor },
		});

		return once(
			actor,
			idempotencyKey,
			fingerprint,
			// A repeated undo is authorized with the inverse its own entry ran, never with the content of the entry
			// it undid, whose annotation gives only the context. The inverse's input is its own entry's content,
			// so once that expired the request goes without it.
			(own) => {
				const original = actionLog.find(number);
				if (!original) throw internalError();
				return requestFor(original, {
					action: own.action,
					input: isExpired(own.expiresAt) ? undefined : own.input,
				});
			},
			(key) => {
				const original = actionLog.find(number);
				if (!original) throw new ORPCError("NOT_FOUND", { message: `no entry ${number}` });
				if (original.undoneBy !== null) throw conflict("already-undone");
				if (!original.inverse) throw notUndoable("irreversible");
				if (isExpired(original.expiresAt)) throw notUndoable("expired");
				if (actionLog.touchedLater(number)) throw conflict("changed-since");

				// The stored inverse is validated once, against the current contract; the same validated input is
				// authorized and runs inside this operation, with its module's rules, without another idempotent
				// operation or another transaction.
				const { stored, target, input } = checkInverse(original.module, original.inverse);
				authorize(requestFor(original, { action: stored.action, input }));
				const receipt = perform(target, actor, input, {
					idempotencyKey: key,
					fingerprint,
					undoes: number,
				});
				actionLog.markUndone(number, receipt.entry);
				return receipt;
			},
		);
	}

	/**
	 * One idempotent operation under `idempotencyKey`, a write or an undo. Looking the key up, running and
	 * logging stay in one synchronous section of one transaction, so no other operation with the same key can
	 * slip in between. The same key under another fingerprint is a conflict. Under the same one, the request
	 * `repeated` builds from the earlier entry is authorized anew and an acknowledgement with its number comes
	 * back, without content and without running anything, whether its content expired or it was undone since
	 * (ADR 0023). A new key goes to `fresh`, which authorizes, runs and logs.
	 */
	function once(
		actor: Actor,
		idempotencyKey: string | undefined,
		fingerprint: string,
		repeated: (earlier: NumberedEntry) => AuthorizationRequest,
		fresh: (idempotencyKey: string) => WriteReceipt,
	): WriteOutcome {
		if (typeof idempotencyKey !== "string" || idempotencyKey === "")
			throw new ORPCError("BAD_REQUEST", { message: "a write needs an idempotency key" });

		return connection.transaction((): WriteOutcome => {
			const keyed = actionLog.findByKey(actor, idempotencyKey);
			if (!keyed) return fresh(idempotencyKey);
			if (keyed.fingerprint !== fingerprint) throw conflict("key-reused");

			const earlier = actionLog.find(keyed.entry);
			if (!earlier) throw internalError();
			authorize(repeated(earlier));
			return { entry: earlier.entry, repeated: true };
		})();
	}

	/** True from `expiresAt` on, by the platform clock: the content of that entry is no longer used. */
	function isExpired(expiresAt: number): boolean {
		return clock() >= expiresAt;
	}

	/**
	 * What a handler's exception leaves as: an error its contract declares, with its data validated by that
	 * error's schema, as oRPC does; anything else, data that fails the schema included, an internal error.
	 */
	function declaredOrInternal(
		found: RegisteredAction,
		error: unknown,
	): ORPCError<string, unknown> {
		if (!(error instanceof ORPCError) || !error.defined) return internalError();
		const declared = found.errorMap[error.code];
		if (declared === undefined) return internalError();
		if (declared.data === undefined) return error;

		const data = validate(declared.data, error.data);
		if (!data.ok) return internalError();
		return new ORPCError(error.code, {
			defined: true,
			status: error.status,
			message: error.message,
			data: data.value,
		});
	}

	/** Runs an authorized write's handler, checks what it returned and logs its entry. */
	function perform(
		found: RegisteredAction,
		actor: Actor,
		input: unknown,
		logged: {
			readonly idempotencyKey: string;
			readonly fingerprint: string;
			readonly undoes?: number;
		},
	): WriteReceipt {
		const now = clock();
		const outcome = checkOutcome(found, run(found, actor, input, now));
		const entry = actionLog.record({
			module: found.module,
			action: found.name,
			actor,
			idempotencyKey: logged.idempotencyKey,
			fingerprint: logged.fingerprint,
			at: now,
			expiresAt: now + retention,
			input,
			inverse: outcome.inverse,
			touched: outcome.touched,
			undoes: logged.undoes,
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

		const output = validate(found.outputSchema, result);
		if (!output.ok || !isLosslessJson(output.value)) throw internalError();

		return {
			result: output.value,
			touched,
			inverse: found.undoable ? checkInverse(found.module, inverse).stored : undefined,
		};
	}

	/**
	 * A valid inverse names a write of the same module, and its input passes that write's contract. The log
	 * keeps the input as the handler gave it (`stored`), the way a caller gives one, so an undo validates it
	 * once against the current contract and authorizes and runs that same validated input (`input`).
	 */
	function checkInverse(
		module: string,
		inverse: unknown,
	): { stored: Inverse; target: RegisteredAction; input: unknown } {
		if (typeof inverse !== "object" || inverse === null) throw internalError();
		const { action, input } = inverse as Record<string, unknown>;
		const target = typeof action === "string" ? registry.get(action) : undefined;
		if (
			typeof action !== "string" ||
			!target ||
			target.module !== module ||
			target.kind !== "write" ||
			!isLosslessJson(input)
		)
			throw internalError();

		const validated = validate(target.inputSchema, input);
		if (!validated.ok || !isLosslessJson(validated.value)) throw internalError();
		return { stored: { action, input }, target, input: validated.value };
	}
}

/**
 * Runs one operation at the edge of this path. The platform's errors and those a contract declares, already
 * sorted by run, leave as they are; anything else, such as a failure writing the log or a schema that throws,
 * leaves without detail.
 */
function guarded<T>(operation: () => T): T {
	try {
		return operation();
	} catch (error) {
		if (error instanceof ORPCError) throw error;
		throw internalError();
	}
}

/** The reasons of a conflict the platform answers (ADR 0022). */
type ConflictReason = "key-reused" | "already-undone" | "changed-since";

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

function isThenable(value: unknown): value is PromiseLike<unknown> {
	return (
		(typeof value === "object" || typeof value === "function") &&
		value !== null &&
		typeof (value as { then?: unknown }).then === "function"
	);
}

/** Lets a promise this path will not wait for settle without an unhandled rejection. */
function settleQuietly(value: PromiseLike<unknown>): void {
	Promise.resolve(value).catch(() => undefined);
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
function writeFingerprint(action: string, input: unknown): string {
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
	let result: ReturnType<AnySchema["~standard"]["validate"]>;
	try {
		result = schema["~standard"].validate(value);
	} catch {
		throw internalError();
	}
	// Validation is synchronous here: a schema that answers later, as zod does when a check throws, fails.
	if (isThenable(result)) {
		settleQuietly(result);
		throw internalError();
	}
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

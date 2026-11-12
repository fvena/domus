// The one path every action takes, whoever asks (ADR 0022): find it, validate its input, ask authorization,
// run its handler and validate its result. A read runs with `PRAGMA query_only` on, takes no idempotency key
// and logs nothing. A write needs a key and runs in one better-sqlite3 transaction that this path opens and
// commits: its handler, the checks of its result and inverse and of every owned row the write capture saw
// change (ADR 0023), and its entry in the action log. Any failure inside rolls back both the change and the
// entry. An undo takes the same path with the inverse its entry
// stored: one transaction for the checks, the inverse, its one new entry and the undone-by link. Neither keeps
// its result: repeating one under the same key answers an acknowledgement without content (ADR 0023). When
// authorization asks for confirmation, nothing runs: the operation waits as a pending confirmation, stored in a
// transaction of its own, and the answer is `CONFIRMATION_REQUIRED` with its id. Confirming it evaluates it all
// again and runs it on this same path, once (ADR 0023). A sensitive operation, an action of level `manage` or a
// sensitive operation of the platform, needs a step-up proof of that exact operation: it is checked, and used in
// the same transaction as the operation, so one that rolls back leaves it unused (ADR 0023). The platform's own
// sensitive operations, such as changing permissions, take this same path as writes of the platform's area, and
// reading the action log, which answers only the annotations of one's own entries, as a read of it. Only the
// represented account that wrote an entry undoes it; for any other, the entry does not exist.
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import {
	type ActionHandler,
	type Actor,
	type Inverse,
	type ModuleDatabase,
	type ModuleDefinition,
	type ModuleSchema,
	type OwnedTable,
	ownedTableOf,
	type TouchedRecord,
} from "@domus/module-sdk";
import type { ActionContract } from "@domus/module-sdk/contracts";
import type { AnySchema, ErrorMap } from "@orpc/contract";
import { createORPCErrorConstructorMap, ORPCError } from "@orpc/server";
import type Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

import type { ActionLog, NumberedEntry } from "../audit";
import {
	type AccessView,
	actorOf,
	type AreaPolicy,
	type AuthorizationRequest,
	type Authorizer,
	type Decision,
	decisionOf,
	isVerified,
	newOwnership,
	type VerifiedContext,
	visibleTo,
} from "../authorization";
import { checkTransition, editableTo, type RecordArea } from "../authorization/writes";
import { answeringWith, type ConfirmationCall } from "./answering";
import type { Capture, CapturedTransition } from "./capture";
import { type ConfirmationTimes, type Confirmations, type NewPending } from "./confirmations";
import { conflict, internalError, notUndoable, stepUpRequired } from "./failures";
import { type PlatformOperation, platformActions } from "./platform-operations";
import type { ProofCheck, Proofs } from "./proofs";
import { provingWith } from "./proving";
import type { RegisteredAction } from "./registry";

/** The platform clock: instants in milliseconds since the epoch (ADR 0021). */
export type Clock = () => number;

/**
 * One invocation: the verified context of who asks (ADR 0023), the action's full name (`<module>.<action>`),
 * its input and, for a write, its key. Its handler receives only the actor the context names.
 */
export interface ActionCall {
	readonly context: VerifiedContext;
	readonly action: string;
	readonly input?: unknown;
	/** The idempotency key the caller gives a write. A read takes none. */
	readonly idempotencyKey?: string;
	/** The step-up proof of this exact operation, when it is sensitive. Never stored, logged or echoed. */
	readonly proof?: string;
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
	 * like a write, or a conflict or a "cannot be undone" with its reason; "not found" for an entry another
	 * represented account wrote.
	 */
	undo(call: UndoCall): WriteOutcome;
	/**
	 * Confirms a pending confirmation of the account that asks and runs its operation once, evaluated again
	 * with the account, via and delegation it was born with. Returns what the operation would have: a read's
	 * result, which is never kept, or a write's {@link WriteOutcome}. Throws "not found" for another account's,
	 * a conflict when its window closed, it expired or it was already consumed or rejected, or what the
	 * operation throws.
	 */
	confirm(call: ConfirmationCall): unknown;
	/** Rejects a pending confirmation, with the same rules of who may as {@link Actions.confirm}. */
	reject(call: ConfirmationCall): void;
	/**
	 * The fingerprint a step-up proof binds to: of an action or an operation of the platform with its input,
	 * validated as invoking it would, or of the undo of an entry. Throws "not found" for an unknown action, and a
	 * bad request for an invalid input or an operation that is not sensitive.
	 */
	fingerprintOf(operation: ProvenOperation): string;
}

/** The operation a step-up proof is asked for: an action, or an operation of the platform, and its input, or an undo. */
export type ProvenOperation =
	| { readonly action: string; readonly input?: unknown }
	| { readonly undo: number };

/** An undo: the verified context of who asks, the number of the entry to undo and the caller's own idempotency key. */
export interface UndoCall {
	readonly context: VerifiedContext;
	readonly entry: number;
	readonly idempotencyKey: string;
	/** The step-up proof of this undo, when its inverse is sensitive. */
	readonly proof?: string;
}

export interface ActionsOptions {
	readonly connection: Database.Database;
	readonly modules: readonly ModuleDefinition[];
	/** Every registered area, with what it declares: owned records take their visibility from it. */
	readonly areas: ReadonlyMap<string, AreaPolicy>;
	readonly authorizer: Authorizer;
	/** What the checks of the write capture read: the grant of an account in a record's area. */
	readonly view: AccessView;
	/** The write capture of the connection, installed once its migrations ran. */
	readonly capture: Capture;
	readonly clock: Clock;
	readonly actionLog: ActionLog;
	/** How long the content of a new entry (input, inverse) stays usable, in milliseconds. */
	readonly retention: number;
	/** Where pending confirmations wait. */
	readonly confirmations: Confirmations;
	/** Where step-up proofs are checked and used. */
	readonly proofs: Proofs;
	/** The platform's own sensitive operations. */
	readonly operations?: readonly PlatformOperation[];
}

export type { ConfirmationCall, ConfirmationTimes, PlatformOperation };
export { platformOperation, READ_DELEGATION, READ_LOG } from "./platform-operations";

/** The actions of `modules`, which `checkModules` has already accepted, on one connection. */
export function createActions({
	connection,
	modules,
	areas,
	authorizer,
	view,
	capture,
	clock,
	actionLog,
	retention,
	confirmations,
	proofs,
	operations = [],
}: ActionsOptions): Actions {
	const registry = new Map<string, RegisteredAction>();
	for (const module of modules) {
		const db = drizzle({ client: connection, schema: module.schema });
		const ownedTables = ownedTablesOf(module, areas);
		for (const [name, contract] of Object.entries(module.contract ?? {})) {
			const handler = module.actions?.[name];
			if (!handler) continue;
			const { meta, inputSchema, outputSchema, errorMap } = contract["~orpc"];
			const parts: ModuleParts = { handler, db, errorMap, ownedTables };
			registry.set(`${module.id}.${name}`, {
				module: module.id,
				name,
				kind: meta.kind,
				undoable: meta.kind === "write" && meta.undoable,
				permission: {
					area: meta.permission.area ?? module.id,
					level: meta.permission.level,
					...(meta.permission.alwaysConfirm === true ? { alwaysConfirm: true } : {}),
				},
				inputSchema,
				outputSchema,
				execute: (context, input, now) => runHandler(parts, actorOf(context), input, now),
			});
		}
	}
	for (const [name, registered] of platformActions(operations, actionLog))
		registry.set(name, registered);
	const proven = provingWith(proofs, clock, authorize);
	const answering = answeringWith({
		connection,
		confirmations,
		clock,
		registry,
		read,
		write,
		undo: undoEntry,
	});

	return {
		invoke: (call) => guarded(() => invoke(call)),
		undo: (call) => guarded(() => undo(call)),
		confirm: (call) => guarded(() => answering.confirm(call)),
		reject: (call) => guarded(() => answering.reject(call)),
		fingerprintOf: (operation) => guarded(() => fingerprintOf(operation)),
	};

	function invoke({ context, action, input, idempotencyKey, proof }: ActionCall): unknown {
		// Only a context the door or the testing entry sealed: nothing on the way can stand in for it.
		if (!isVerified(context)) throw internalError();
		const { found, value } = validated(action, input);
		return found.kind === "write"
			? write(found, context, action, value, { idempotencyKey, proof })
			: read(found, context, action, value, { proof });
	}

	/** The registered action called `action` and its input, validated by its contract. */
	function validated(
		action: string,
		input: unknown,
	): { readonly found: RegisteredAction; readonly value: unknown } {
		const found = registry.get(action);
		if (!found) throw new ORPCError("NOT_FOUND", { message: `no action "${action}"` });
		const checked = validate(found.inputSchema, input);
		if (!checked.ok || !isLosslessJson(checked.value))
			throw new ORPCError("BAD_REQUEST", {
				message: "invalid input",
				data: { issues: checked.ok ? [] : checked.issues },
			});
		return { found, value: checked.value };
	}

	function fingerprintOf(operation: ProvenOperation): string {
		if ("undo" in operation) return undoFingerprint(operation.undo);
		const { found, value } = validated(operation.action, operation.input);
		if (found.permission.level !== "manage" && found.sensitive === undefined)
			throw new ORPCError("BAD_REQUEST", { message: "not a sensitive operation" });
		return operationFingerprint(operation.action, value);
	}

	/** What authorization needs to know of an operation of the platform: whether it is sensitive, and its subject. */
	function sensitivityOf(
		found: RegisteredAction,
		input: unknown,
		context: VerifiedContext,
	): Pick<AuthorizationRequest, "sensitive" | "subject"> {
		const subject = found.subject?.(input, context);
		return {
			...(found.sensitive === undefined ? {} : { sensitive: found.sensitive }),
			...(subject === undefined ? {} : { subject }),
		};
	}

	/**
	 * Asks authorization, which fails closed: a denial, any other answer or a throw end forbidden. Asking for
	 * confirmation throws {@link ConfirmationNeeded}, which the caller turns into a pending confirmation once
	 * whatever it opened rolled back.
	 */
	function authorize(request: AuthorizationRequest): void {
		ANSWERS[decisionOf(authorizer, request)]();
	}

	/**
	 * Runs `operation`; when authorization asked for confirmation, stores what waits in a transaction of its
	 * own, or finds the one the same request left before, and answers `CONFIRMATION_REQUIRED` with its id.
	 */
	function orPending<T>(pending: NewPending, operation: () => T): T {
		let contextOnly: boolean;
		try {
			return operation();
		} catch (error) {
			if (!(error instanceof ConfirmationNeeded)) throw error;
			contextOnly = error.confirmedIn === "context-only";
		}
		const id = connection.transaction(() => {
			const { kind, origin, fingerprint, key } = pending;
			const earlier =
				kind === "read" || key === undefined
					? confirmations.findRead(origin, fingerprint, clock())
					: confirmations.findWrite(actorOf(origin), key);
			if (!earlier) return confirmations.create({ ...pending, contextOnly }, clock());
			if (earlier.fingerprint !== fingerprint) throw conflict("key-reused");
			return earlier.id;
		})();
		throw new ORPCError("CONFIRMATION_REQUIRED", {
			status: 428,
			message: "the person must confirm this operation first",
			data: { confirmation: id },
		});
	}

	/** Runs a handler; only an error its contract declares leaves as it is. */
	function runHandler(parts: ModuleParts, actor: Actor, input: unknown, now: number): unknown {
		/** The area of one of the module's owned tables; any other table is a mistake of the handler. */
		const areaOf = (table: OwnedTable): RecordArea => {
			const area = parts.ownedTables.get(table);
			if (!area) throw new Error("not an owned table of this module");
			return area;
		};
		let outcome: unknown;
		try {
			outcome = parts.handler({
				input,
				db: parts.db,
				actor,
				now,
				errors: createORPCErrorConstructorMap(parts.errorMap),
				visible: (table) => {
					areaOf(table);
					return visibleTo(table, actor.account);
				},
				editable: (table) => editableTo(table, actor.account, areaOf(table), view),
				forbidden: () => new HandlerForbidden(),
				ownership: (table) =>
					newOwnership(actor.account, areaOf(table).policy.defaultVisibility),
			});
		} catch (error) {
			if (error instanceof HandlerForbidden) throw error;
			throw declaredOrInternal(parts.errorMap, error);
		}
		// An async handler, which its type forbids: what it would do later falls outside the transaction.
		if (isThenable(outcome)) {
			settleQuietly(outcome);
			throw internalError();
		}
		return outcome;
	}

	function read(
		found: RegisteredAction,
		context: VerifiedContext,
		action: string,
		input: unknown,
		{ proof, confirmed = false }: { readonly proof?: string; readonly confirmed?: boolean },
	): unknown {
		const fingerprint = operationFingerprint(action, input);
		const checked = proofs.check(proof, context, fingerprint, clock());
		const request: AuthorizationRequest = {
			context,
			action,
			kind: "read",
			permission: found.permission,
			input,
			...sensitivityOf(found, input, context),
			...(confirmed ? { confirmed } : {}),
			...(checked === undefined ? {} : { proof: checked }),
		};
		orPending(
			{ kind: "read", operation: { action, input }, fingerprint, origin: context },
			() => authorize(request),
		);

		let result: unknown;
		connection.pragma("query_only = ON");
		try {
			result = found.execute(context, input, clock());
		} finally {
			connection.pragma("query_only = OFF");
		}

		const output = validate(found.outputSchema, result);
		if (!output.ok) throw internalError();
		// Used only once the read answered: one that failed leaves its proof unused.
		if (proof !== undefined && checked === "valid") proofs.use(proof);
		return output.value;
	}

	function write(
		found: RegisteredAction,
		context: VerifiedContext,
		action: string,
		input: unknown,
		{
			idempotencyKey,
			proof,
			confirmed = false,
		}: {
			readonly idempotencyKey: string | undefined;
			readonly proof?: string | undefined;
			readonly confirmed?: boolean;
		},
	): WriteOutcome {
		const actor = actorOf(context);
		const fingerprint = operationFingerprint(action, input);
		const requestWith = (checked: ProofCheck | undefined): AuthorizationRequest => ({
			context,
			action,
			kind: "write",
			permission: found.permission,
			input,
			...sensitivityOf(found, input, context),
			...(confirmed ? { confirmed } : {}),
			...(checked === undefined ? {} : { proof: checked }),
		});

		return orPending(
			{
				kind: "write",
				operation: { action, input },
				fingerprint,
				...(idempotencyKey === undefined ? {} : { key: idempotencyKey }),
				origin: context,
			},
			() =>
				once(
					{ actor, idempotencyKey, fingerprint, proof },
					// A repeat is authorized again, its proof included: the one its write used still counts.
					(earlier) =>
						requestWith(
							proofs.check(proof, context, fingerprint, clock(), earlier.entry),
						),
					(key) => {
						found.find?.(input, context);
						return proven(proof, context, fingerprint, requestWith, () =>
							perform(found, context, input, { idempotencyKey: key, fingerprint }),
						);
					},
				),
		);
	}

	function undo(call: UndoCall): WriteOutcome {
		if (!isVerified(call.context)) throw internalError();
		return undoEntry(call);
	}

	function undoEntry(
		{ context, entry: number, idempotencyKey, proof }: UndoCall,
		confirmed = false,
	): WriteOutcome {
		const actor = actorOf(context);
		const fingerprint = undoFingerprint(number);

		/** The request to authorization for an inverse, with the context of the entry it undoes. */
		const requestFor = (
			original: NumberedEntry,
			inverse: Inverse,
			checked: ProofCheck | undefined,
		): AuthorizationRequest => {
			const target = registry.get(inverse.action);
			if (!target) throw internalError();
			return {
				context,
				action: inverse.action,
				kind: "write",
				permission: target.permission,
				input: inverse.input,
				undoes: { entry: original.entry, action: original.action, actor: original.actor },
				...(confirmed ? { confirmed } : {}),
				...(checked === undefined ? {} : { proof: checked }),
			};
		};

		return orPending(
			{
				kind: "write",
				operation: { undo: number },
				fingerprint,
				key: idempotencyKey,
				origin: context,
			},
			() =>
				once(
					{ actor, idempotencyKey, fingerprint, proof },
					// A repeated undo is authorized with the inverse its own entry ran, never with the content of the entry
					// it undid, whose annotation gives only the context. The inverse's input is its own entry's content,
					// so once that expired the request goes without it.
					(own) => {
						const original = actionLog.find(number);
						if (!original) throw internalError();
						return requestFor(
							original,
							{
								action: own.action,
								input: isExpired(own.expiresAt) ? undefined : own.input,
							},
							proofs.check(proof, context, fingerprint, clock(), own.entry),
						);
					},
					(key) => {
						const original = actionLog.find(number);
						// Only the represented account that wrote it undoes an entry: another one's does not exist.
						if (original?.actor.account !== context.account)
							throw new ORPCError("NOT_FOUND", { message: `no entry ${number}` });
						if (original.undoneBy !== null) throw conflict("already-undone");
						const expired = isExpired(original.expiresAt);
						// The cleanup empties the inverse of an expired entry (ADR 0025), so an expired entry without one is
						// irreversible only when its action has none: the answer is the same before and after cleaning.
						if (
							!original.inverse &&
							!(expired && registry.get(original.action)?.undoable)
						)
							throw notUndoable("irreversible");
						if (expired) throw notUndoable("expired");
						if (actionLog.touchedLater(number)) throw conflict("changed-since");

						// The stored inverse is validated once, against the current contract; the same validated input is
						// authorized and runs inside this operation, with its module's rules, without another idempotent
						// operation or another transaction.
						const { stored, target, input } = checkInverse(
							original.module,
							original.inverse,
						);
						const receipt = proven(
							proof,
							context,
							fingerprint,
							(checked) =>
								requestFor(original, { action: stored.action, input }, checked),
							() =>
								perform(target, context, input, {
									idempotencyKey: key,
									fingerprint,
									undoes: number,
								}),
						);
						actionLog.markUndone(number, receipt.entry);
						return receipt;
					},
				),
		);
	}

	/**
	 * One idempotent operation under `idempotencyKey`, a write or an undo. Looking the key up, running and
	 * logging stay in one synchronous section of one transaction, so no other operation with the same key can
	 * slip in between. The same key under another fingerprint is a conflict. Under the same one, the request
	 * `repeated` builds from the earlier entry is authorized anew, its `proof` included, and an acknowledgement
	 * with its number comes back, without content and without running anything, whether its content expired or
	 * it was undone since (ADR 0023). Only the confirmation counts as given, as when confirming a pending one:
	 * a denial and a missing proof stop it. A fresh proof it brings is spent as a write spends one, and linked to
	 * the earlier entry. A new key goes to `fresh`, which authorizes, runs and logs.
	 */
	function once(
		{ actor, idempotencyKey, fingerprint, proof }: KeyedWrite,
		repeated: (earlier: NumberedEntry) => AuthorizationRequest,
		fresh: (idempotencyKey: string) => WriteReceipt,
	): WriteOutcome {
		if (typeof idempotencyKey !== "string" || idempotencyKey === "")
			throw new ORPCError("BAD_REQUEST", { message: "a write needs an idempotency key" });

		return connection.transaction((): WriteOutcome => {
			const keyed = actionLog.findByKey(actor, idempotencyKey);
			if (!keyed) {
				// A key a pending confirmation holds names that operation and no other.
				const waiting = confirmations.findWrite(actor, idempotencyKey);
				if (waiting && waiting.fingerprint !== fingerprint) throw conflict("key-reused");
				return fresh(idempotencyKey);
			}
			if (keyed.fingerprint !== fingerprint) throw conflict("key-reused");

			const earlier = actionLog.find(keyed.entry);
			if (!earlier) throw internalError();
			// An acknowledgement runs nothing and shows nothing: being asked to confirm does not stop it, but
			// a sensitive one asks for its proof again.
			const request = repeated(earlier);
			authorize({ ...request, confirmed: true });
			if (proof !== undefined && request.proof === "valid") {
				proofs.use(proof);
				proofs.link(proof, earlier.entry);
			}
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
	function declaredOrInternal(errorMap: ErrorMap, error: unknown): ORPCError<string, unknown> {
		if (!(error instanceof ORPCError) || !error.defined) return internalError();
		const declared = errorMap[error.code];
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
		context: VerifiedContext,
		input: unknown,
		logged: {
			readonly idempotencyKey: string;
			readonly fingerprint: string;
			readonly undoes?: number;
		},
	): WriteReceipt {
		const now = clock();
		const actor = actorOf(context);
		const { value, transitions } = capture.watch(() => found.execute(context, input, now));
		const outcome = checkOutcome(found, value);
		checkTransitions(found, actor.account, transitions, outcome.touched);
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
		capture.clear();
		return { result: outcome.result, entry };
	}

	/**
	 * Checks, in order, each transition of an owned record the write made (ADR 0023): the rules of what a write
	 * may do to it, then that the handler declared it among its touched records, which only its own module's
	 * records can be. Editing what authorization does not allow is forbidden; any other break, internal.
	 */
	function checkTransitions(
		found: RegisteredAction,
		account: string,
		transitions: readonly CapturedTransition[],
		touched: readonly TouchedRecord[],
	): void {
		for (const transition of transitions) {
			const { table } = transition;
			const check = checkTransition(transition, account, table.area, view);
			if (check === "forbidden") throw new ORPCError("FORBIDDEN");
			if (check !== "allow") throw internalError();
			const id = transition.operation === "insert" ? transition.newId : transition.oldId;
			if (
				table.module !== found.module ||
				!touched.some((record) => record.type === table.type && record.id === id)
			)
				throw internalError();
		}
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

/** What running a module's handler needs: the handler, its module's database, errors and owned tables. */
interface ModuleParts {
	readonly handler: ActionHandler<ActionContract, ModuleSchema>;
	readonly db: ModuleDatabase<ModuleSchema>;
	/** The errors its contract declares: the only ones its handler's throws leave with. */
	readonly errorMap: ErrorMap;
	/** The owned tables of its module, with each one's area. */
	readonly ownedTables: ReadonlyMap<OwnedTable, RecordArea>;
}

/** The owned tables of a module, which `checkModules` has accepted, each with its area. */
function ownedTablesOf(
	module: ModuleDefinition,
	areas: ReadonlyMap<string, AreaPolicy>,
): ReadonlyMap<OwnedTable, RecordArea> {
	const owned = new Map<OwnedTable, RecordArea>();
	for (const value of Object.values(module.schema)) {
		const info = ownedTableOf(value);
		const policy = info && areas.get(info.area);
		if (info && policy) owned.set(value as OwnedTable, { id: info.area, policy });
	}
	return owned;
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

/** A write as {@link once} keys it: who asks, under which key, for which operation, with which proof. */
interface KeyedWrite {
	readonly actor: Actor;
	readonly idempotencyKey: string | undefined;
	readonly fingerprint: string;
	readonly proof: string | undefined;
}

/**
 * Where a pending confirmation may be answered: by the app or in context, or `context-only`, by the channel
 * `contexto` inside its window (the shared device rule).
 */
type ConfirmedIn = "app-or-context" | "context-only";

/**
 * Authorization asked for confirmation: whatever was opened rolls back and the operation waits, to be answered
 * where `confirmedIn` says.
 */
class ConfirmationNeeded extends Error {
	constructor(readonly confirmedIn: ConfirmedIn) {
		super("confirmation needed");
	}
}

/** What the path does with each decision of authorization: go on, or throw what stops the operation. */
const ANSWERS: Readonly<Record<Decision, () => void>> = {
	allow: () => undefined,
	deny: () => {
		throw new ORPCError("FORBIDDEN");
	},
	confirm: () => {
		throw new ConfirmationNeeded("app-or-context");
	},
	"confirm-in-context": () => {
		throw new ConfirmationNeeded("context-only");
	},
	"step-up": () => {
		throw stepUpRequired();
	},
};

/** The denial a handler throws through `forbidden()`, the one error of its own that leaves as it is. */
class HandlerForbidden extends ORPCError<"FORBIDDEN", undefined> {
	constructor() {
		super("FORBIDDEN");
	}
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
 * The fingerprint of an action, a write or a read waiting for confirmation: its full name and the SHA-256 of
 * its validated input as canonical JSON (keys sorted), so the order of the properties does not change it.
 */
function operationFingerprint(action: string, input: unknown): string {
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

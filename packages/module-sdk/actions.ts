// What a module's `server/` writes to implement its contract (ADR 0022): one synchronous handler per action.
// The context is the only place where a module's production code gets its database: the SDK offers no
// other way to obtain it.
import type {
	AnySchema,
	ContractProcedure,
	ErrorMap,
	InferSchemaInput,
	InferSchemaOutput,
	ORPCError,
} from "@orpc/contract";
import type { SQL } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

import type { ActionContract, ModuleContract, ReadActionMeta, WriteActionMeta } from "./contracts";
import type { OwnedTable, Visibility } from "./db";

/** What a module's exports may hold: its tables, made with `moduleTables`, and anything else Drizzle reads. */
export type ModuleSchema = Readonly<Record<string, unknown>>;

/** The Drizzle client of one module, typed with its schema. */
export type ModuleDatabase<TSchema extends ModuleSchema> = BetterSQLite3Database<TSchema>;

/**
 * Who asks for an action: the account represented and, when another one carries the request, the
 * authenticated app that carries it (`via`). Both are opaque ids; phase 1c takes them from authentication.
 */
export interface Actor {
	readonly account: string;
	readonly via?: string;
}

/**
 * One constructor per error the action's contract declares. A handler throws what it builds, and the error
 * leaves the platform as it is; any other exception leaves as an internal error.
 */
export type ActionErrors<TErrorMap extends ErrorMap> = {
	readonly [TCode in keyof TErrorMap & string]: ErrorConstructor<
		TCode,
		ErrorDataOf<TErrorMap[TCode]>
	>;
};

/**
 * The constructor of one declared error. Its data is the input of the error's schema: required when the
 * schema requires it, optional when it admits `undefined`, absent when the error declares no data. oRPC's
 * own constructor map lets any data through under this compiler, so Domus spells it out.
 */
type ErrorConstructor<TCode extends string, TData> = [TData] extends [undefined]
	? (options?: ErrorOptions) => ORPCError<TCode, undefined>
	: undefined extends TData
		? (options?: ErrorOptions & { readonly data?: TData }) => ORPCError<TCode, TData>
		: (options: ErrorOptions & { readonly data: TData }) => ORPCError<TCode, TData>;

interface ErrorOptions {
	readonly message?: string;
	readonly cause?: unknown;
}

/** The input of a declared error's data schema, or `undefined` when it declares none. */
type ErrorDataOf<TItem> = [ErrorSchemaOf<TItem>] extends [never]
	? undefined
	: InferSchemaInput<ErrorSchemaOf<TItem>>;

type ErrorSchemaOf<TItem> = Extract<
	NonNullable<TItem extends { readonly data?: infer TSchema } ? TSchema : never>,
	AnySchema
>;

/** What a handler receives. A handler never keeps it to use after it returns. */
export interface ActionContext<
	TInput,
	TSchema extends ModuleSchema,
	TErrorMap extends ErrorMap = ErrorMap,
> {
	/** The input, already validated by the contract. */
	readonly input: TInput;
	/** The module's own database. */
	readonly db: ModuleDatabase<TSchema>;
	readonly actor: Actor;
	/** The platform clock's instant, in milliseconds since the epoch (ADR 0021). */
	readonly now: number;
	/** The errors its contract declares. */
	readonly errors: ActionErrors<TErrorMap>;
	/**
	 * The visibility predicate of one of its module's owned tables (ADR 0023): the records the represented
	 * account sees, its own and the public ones. Every query on an owned table puts it in `where`, counts and
	 * searches included, and a join carries one per owned table. A record it hides does not exist: the action
	 * answers "not found".
	 */
	readonly visible: (table: OwnedTable) => SQL;
	/**
	 * The owner and visibility of a new record of one of its module's owned tables: the represented account,
	 * and the default visibility of the table's area. Spread into the values of an insert.
	 */
	readonly ownership: (table: OwnedTable) => NewOwnership;
}

/** What a new owned record takes: its owner and its visibility. */
export interface NewOwnership {
	readonly owner: string;
	readonly visibility: Visibility;
}

/** A record of its own module that a write changed, by type and id, so undo can see later changes. */
export interface TouchedRecord {
	readonly type: string;
	readonly id: string | number;
}

/**
 * The action that undoes a write: a write of the same module, by its full name (`<module>.<action>`), and its
 * input. The platform checks both before it commits the write.
 */
export interface Inverse {
	readonly action: string;
	readonly input: unknown;
}

/** What a write's handler returns: its result and the records it touched. */
export interface WriteOutcome<TResult> {
	readonly result: TResult;
	readonly touched: readonly TouchedRecord[];
}

/** What a caller passes to an action: its contract's input before validation. */
export type ActionInput<TAction> =
	TAction extends ContractProcedure<
		infer TInputSchema,
		infer _TOutput,
		infer _TErrors,
		infer _TMeta
	>
		? InferSchemaInput<TInputSchema>
		: never;

/** What a caller receives from an action: its contract's output after validation. */
export type ActionOutput<TAction> =
	TAction extends ContractProcedure<
		infer _TInput,
		infer TOutputSchema,
		infer _TErrors,
		infer _TMeta
	>
		? InferSchemaOutput<TOutputSchema>
		: never;

/** The metadata of an action: whether it reads or writes, and whether a write can be undone. */
export type ActionMetaOf<TAction> =
	TAction extends ContractProcedure<infer _I, infer _O, infer _E, infer TMeta> ? TMeta : never;

/** What a handler returns before the platform validates it, as its contract's output schema takes it. */
type HandlerResult<TAction> =
	TAction extends ContractProcedure<infer _I, infer TOutputSchema, infer _E, infer _M>
		? InferSchemaInput<TOutputSchema>
		: never;

/**
 * A read returns its result. A write returns a {@link WriteOutcome} and, only when its contract declares
 * it undoable, its {@link Inverse}. An action whose kind is not known here (the plain `ModuleDefinition`
 * the platform takes) may return anything: the platform checks it.
 */
type HandlerReturn<TAction> =
	ActionMetaOf<TAction> extends ReadActionMeta
		? HandlerResult<TAction>
		: ActionMetaOf<TAction> extends WriteActionMeta<true>
			? WriteOutcome<HandlerResult<TAction>> & { readonly inverse: Inverse }
			: ActionMetaOf<TAction> extends WriteActionMeta<false>
				? WriteOutcome<HandlerResult<TAction>> & { readonly inverse?: undefined }
				: unknown;

/**
 * The handler of one action. Written as a method so a module with typed handlers still fits the plain
 * `ModuleDefinition` that the platform takes.
 */
export type ActionHandler<TAction extends ActionContract, TSchema extends ModuleSchema> = {
	handle(
		context: ActionContext<
			TAction extends ContractProcedure<infer TInputSchema, infer _O, infer _E, infer _M>
				? InferSchemaOutput<TInputSchema>
				: never,
			TSchema,
			TAction extends ContractProcedure<infer _I, infer _O, infer TErrorMap, infer _M>
				? TErrorMap
				: never
		>,
	): HandlerReturn<TAction>;
}["handle"];

/** The implementation of a contract: one handler per action, by the same names. */
export type ModuleActions<TContract extends ModuleContract, TSchema extends ModuleSchema> = {
	readonly [TName in keyof TContract]: ActionHandler<TContract[TName], TSchema>;
};

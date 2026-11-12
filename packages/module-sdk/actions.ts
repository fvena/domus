// What a module's `server/` writes to implement its contract (ADR 0022): one synchronous handler per action.
// The context is the only place where a module's production code gets its database: the SDK offers no
// other way to obtain it.
import type { ContractProcedure, InferSchemaInput, InferSchemaOutput } from "@orpc/contract";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

import type { ActionContract, ModuleContract } from "./contracts";

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

/** What a handler receives. A handler never keeps it to use after it returns. */
export interface ActionContext<TInput, TSchema extends ModuleSchema> {
	/** The input, already validated by the contract. */
	readonly input: TInput;
	/** The module's own database. */
	readonly db: ModuleDatabase<TSchema>;
	readonly actor: Actor;
	/** The platform clock's instant, in milliseconds since the epoch (ADR 0021). */
	readonly now: number;
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
			TSchema
		>,
	): TAction extends ContractProcedure<infer _I, infer TOutputSchema, infer _E, infer _M>
		? InferSchemaInput<TOutputSchema>
		: never;
}["handle"];

/** The implementation of a contract: one handler per action, by the same names. */
export type ModuleActions<TContract extends ModuleContract, TSchema extends ModuleSchema> = {
	readonly [TName in keyof TContract]: ActionHandler<TContract[TName], TSchema>;
};

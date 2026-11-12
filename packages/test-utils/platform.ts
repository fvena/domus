import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
	ActionInput,
	ActionMetaOf,
	ActionOutput,
	Actor,
	ModuleDefinition,
	ModuleSchema,
} from "@domus/module-sdk";
import type { WriteActionMeta } from "@domus/module-sdk/contracts";
import { createHttpHandler, type HttpHandler, type Platform } from "@domus/platform";
import {
	type Authorizer,
	createPlatformWith,
	type Decision,
	invokeAction,
	type LogEntry,
	type ModuleDatabase,
	moduleDatabase,
	readLog,
	undoEntry,
	type WriteReceipt,
} from "@domus/platform/testing";

type AnyModule = ModuleDefinition;

/** The full name of every action of `TModules`: `<module>.<action>`. */
export type ActionName<TModules extends readonly AnyModule[]> =
	TModules[number] extends infer TModule
		? TModule extends ModuleDefinition<infer _TSchema, infer TContract, infer TId>
			? `${TId}.${keyof TContract & string}`
			: never
		: never;

/** The contract of the action called `TName` among `TModules`. */
type ActionContractOf<
	TModules extends readonly AnyModule[],
	TName,
> = TModules[number] extends infer TModule
	? TModule extends ModuleDefinition<infer _TSchema, infer TContract, infer TId>
		? TName extends `${TId}.${infer TAction}`
			? TAction extends keyof TContract
				? TContract[TAction]
				: never
			: never
		: never
	: never;

/** An action without input, or with an optional one, may be called without it. */
type InputArguments<TInput> = unknown extends TInput
	? [input?: unknown]
	: undefined extends TInput
		? [input?: TInput]
		: [input: TInput];

/** What a write takes besides its input. */
export interface WriteOptions {
	/** The caller's name for this operation. */
	readonly idempotencyKey: string;
}

/** A read takes its input; a write takes its input, even when it has none, and its key. */
type InvokeArguments<TAction> =
	ActionMetaOf<TAction> extends WriteActionMeta
		? [input: ActionInput<TAction>, options: WriteOptions]
		: InputArguments<ActionInput<TAction>>;

/** A read returns its result; a write, its result and the number of its entry in the action log. */
export type InvokeResult<TAction> =
	ActionMetaOf<TAction> extends WriteActionMeta
		? { readonly result: ActionOutput<TAction>; readonly entry: number }
		: ActionOutput<TAction>;

export interface TestPlatformOptions<TModules extends readonly AnyModule[]> {
	/** The modules under test: tests import them and pass them here; test-utils imports none. */
	readonly modules: TModules;
	/**
	 * Where the database lives. Unset: in memory. `true`: a file in a temporary folder, removed on
	 * close. A path: that file, kept on close, for tests that open the same data again.
	 */
	readonly file?: true | string;
	/** How long the content of a new log entry stays usable, in milliseconds. Unset: the platform's 30 days. */
	readonly retention?: number;
}

/** The platform clock of a test: it moves only when the test moves it. */
export interface TestClock {
	now(): number;
	set(instant: number): void;
	advance(milliseconds: number): void;
}

export interface TestPlatform<
	TModules extends readonly AnyModule[] = readonly AnyModule[],
> extends AsyncDisposable {
	readonly platform: Platform;
	/** The door, in process, on this platform. */
	readonly door: HttpHandler;
	/** `":memory:"` or the path of the file in use. */
	readonly databaseFile: string;
	/** Starts at {@link TEST_START}, in milliseconds since the epoch. */
	readonly clock: TestClock;
	/**
	 * The Drizzle client of one of `modules`, typed with its schema, for tests to prepare and read data
	 * directly, outside the actions. Only tests have it.
	 */
	dbFor<TSchema extends ModuleSchema>(module: ModuleDefinition<TSchema>): ModuleDatabase<TSchema>;
	/**
	 * What the authorizer answers from the next call on: "allow", "deny", or a function that decides, or
	 * throws, for each request. It starts allowing.
	 */
	authorize(answer: Decision | Authorizer): void;
	/** A synthetic actor: an account and, when another app carries the request, its `via`. */
	actor(account: string, options?: { readonly via?: string }): Actor;
	/**
	 * Runs an action of `modules` through the platform's real path. A read takes no key and returns its
	 * result. A write takes its key and returns its result and entry number. Platform errors, and those a
	 * contract declares, are thrown with their oRPC `code`.
	 */
	invoke<TName extends ActionName<TModules>>(
		actor: Actor,
		action: TName,
		...args: InvokeArguments<ActionContractOf<TModules, TName>>
	): InvokeResult<ActionContractOf<TModules, TName>>;
	/**
	 * Undoes the entry numbered `entry` through the platform's real path, with its own key: the inverse the
	 * entry stored runs and logs one new entry. Returns the inverse's result and that entry's number.
	 */
	undo(actor: Actor, entry: number, options: WriteOptions): WriteReceipt;
	/**
	 * A read-only snapshot of the action log: every entry, in order, with its content even when expired. That
	 * exception is only for tests.
	 */
	log(): readonly LogEntry[];
	/** Closes the platform and removes the temporary folder it created. Safe to call more than once. */
	close(): void;
}

/** Where the clock of every test platform starts: 2026-01-01T00:00:00Z. */
export const TEST_START = Date.UTC(2026, 0, 1);

/**
 * A real platform for tests, with the migrations of the platform and of `modules` applied: in memory by
 * default, or on a file. Its authorizer and clock are the test's. Use it with `await using`.
 */
export function createTestPlatform<const TModules extends readonly AnyModule[]>({
	modules,
	file,
	retention,
}: TestPlatformOptions<TModules>): TestPlatform<TModules> {
	let tempDir: string | undefined;
	let databaseFile = file ?? ":memory:";
	if (databaseFile === true) {
		tempDir = mkdtempSync(join(tmpdir(), "domus-test-"));
		databaseFile = join(tempDir, "domus.db");
	}

	let authorizer: Authorizer = () => "allow";
	let now = TEST_START;
	const clock: TestClock = {
		now: () => now,
		set: (instant) => {
			now = instant;
		},
		advance: (milliseconds) => {
			now += milliseconds;
		},
	};

	let platform: Platform;
	try {
		platform = createPlatformWith(
			{ databaseFile, modules, retention },
			{ authorizer: (request) => authorizer(request), clock: () => now },
		);
	} catch (error) {
		if (tempDir) rmSync(tempDir, { recursive: true, force: true });
		throw error;
	}

	const close = () => {
		platform.close();
		if (tempDir) rmSync(tempDir, { recursive: true, force: true });
	};

	return {
		platform,
		door: createHttpHandler({ platform, modules }),
		databaseFile,
		clock,
		dbFor: (module) => moduleDatabase(platform, module),
		authorize: (answer) => {
			authorizer = typeof answer === "function" ? answer : () => answer;
		},
		actor: (account, options) =>
			options?.via === undefined ? { account } : { account, via: options.via },
		invoke: (actor, action, ...[input, options]) =>
			invokeAction(platform, {
				actor,
				action,
				input,
				idempotencyKey: options?.idempotencyKey,
			}) as never,
		undo: (actor, entry, { idempotencyKey }) =>
			undoEntry(platform, { actor, entry, idempotencyKey }),
		log: () => readLog(platform),
		close,
		[Symbol.asyncDispose]: () => Promise.resolve(close()),
	};
}

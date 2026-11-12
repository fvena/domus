import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
	ActionInput,
	ActionMetaOf,
	ActionOutput,
	ModuleDefinition,
	ModuleSchema,
} from "@domus/module-sdk";
import type { WriteActionMeta } from "@domus/module-sdk/contracts";
import { createHttpHandler, type HttpHandler, type Platform } from "@domus/platform";
import {
	createPlatformWithClock,
	type Delegated,
	type DelegationTable,
	deviceAccountOf,
	type Grant,
	hasAccount,
	invokeAction,
	type LogEntry,
	type ModuleDatabase,
	moduleDatabase,
	type PermissionLevel,
	prepareAccount,
	prepareDelegation,
	prepareGrant,
	preparePassword,
	readDelegationOf,
	readLog,
	syntheticContext,
	type Acknowledgement,
	undoEntry,
	type VerifiedContext,
	type WriteOutcome,
} from "@domus/platform/testing";

import { createTestBrowser, type TestBrowser } from "./browser";

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

/**
 * A read returns its result. A write returns its result and the number of its entry in the action log the
 * first time, and an acknowledgement without content when repeated.
 */
export type InvokeResult<TAction> =
	ActionMetaOf<TAction> extends WriteActionMeta
		? { readonly result: ActionOutput<TAction>; readonly entry: number } | Acknowledgement
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

/** A new account of the privileged preparation. `id` doubles as its name and the start of its email. */
export interface PreparedAccount {
	readonly id: string;
	readonly role: "admin" | "member";
	readonly name?: string;
	readonly email?: string;
}

/**
 * The privileged preparation: accounts, passwords and permission rows written straight into the platform,
 * without a session or a proof. Only tests have it.
 */
export interface TestPreparation {
	/** Creates an account with its role and no password. Returns its id. A repeated id or email throws. */
	account(account: PreparedAccount): string;
	/** Gives an account a password, so it can sign in over HTTP through the door. */
	password(account: string, password: string): Promise<void>;
	/** Stores the row that replaces the default of the account's role in the area: `none` to `manage`. */
	grant(account: string, area: string, grant: Grant): void;
	/** Stores what the account delegates to Kira at one level of the area: `no`, `yes` or `confirm`. */
	delegation(account: string, area: string, level: PermissionLevel, value: Delegated): void;
}

/** What a synthetic context may set besides its account. */
export type ContextOptions = Partial<Omit<VerifiedContext, "account">>;

export interface TestPlatform<
	TModules extends readonly AnyModule[] = readonly AnyModule[],
> extends AsyncDisposable {
	readonly platform: Platform;
	/** The door, in process, on this platform. Its origin is {@link TEST_ORIGIN}. */
	readonly door: HttpHandler;
	/** `":memory:"` or the path of the file in use. */
	readonly databaseFile: string;
	/** A new browser, without cookies, on {@link door}. */
	browser(): TestBrowser;
	/** Starts at {@link TEST_START}, in milliseconds since the epoch. */
	readonly clock: TestClock;
	readonly prepare: TestPreparation;
	/** The id of the one device account, which the platform creates at start. */
	readonly deviceAccount: string;
	/**
	 * The Drizzle client of one of `modules`, typed with its schema, for tests to prepare and read data
	 * directly, outside the actions. Only tests have it.
	 */
	dbFor<TSchema extends ModuleSchema>(module: ModuleDefinition<TSchema>): ModuleDatabase<TSchema>;
	/**
	 * A synthetic verified context for `account`. Unless `options` say otherwise: no via, a test device and
	 * session, the account itself as the device's, the app channel, proven by password, no conversation.
	 */
	context(account: string, options?: ContextOptions): VerifiedContext;
	/** Creates the member `id` the first time, and returns a synthetic context for it as {@link context}. */
	member(id: string, options?: ContextOptions): VerifiedContext;
	/**
	 * Runs an action of `modules` through the platform's real path, with the real authorization. A read takes
	 * no key and returns its result. A write takes its key and returns its result and entry number, or
	 * `{ entry, repeated: true }` when its key and request were already done. Platform errors, and those a
	 * contract declares, are thrown with their oRPC `code`.
	 */
	invoke<TName extends ActionName<TModules>>(
		context: VerifiedContext,
		action: TName,
		...args: InvokeArguments<ActionContractOf<TModules, TName>>
	): InvokeResult<ActionContractOf<TModules, TName>>;
	/**
	 * Undoes the entry numbered `entry` through the platform's real path, with its own key: the inverse the
	 * entry stored runs and logs one new entry. Returns the inverse's result and that entry's number, or an
	 * acknowledgement when its key was already done.
	 */
	undo(context: VerifiedContext, entry: number, options: WriteOptions): WriteOutcome;
	/**
	 * Reads the delegation table of `account` through the platform's real operation: each registered area with
	 * its three levels, `no` where there is no row. Each person reads their own and the admin the device
	 * account's; anything else is thrown as `FORBIDDEN`.
	 */
	delegation(context: VerifiedContext, account: string): DelegationTable;
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

/** The origin the door of a test platform answers on. */
export const TEST_ORIGIN = "http://domus.test";

/** The secret that signs the sessions of a test platform: only for tests. */
const TEST_AUTH_SECRET = "test-only-secret-that-signs-test-sessions";

/**
 * A real platform for tests, with the migrations of the platform and of `modules` applied: in memory by
 * default, or on a file. Its authorization is the real one; its clock is the test's. Use it with `await using`.
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
		platform = createPlatformWithClock({ databaseFile, modules, retention }, () => now);
	} catch (error) {
		if (tempDir) rmSync(tempDir, { recursive: true, force: true });
		throw error;
	}

	const close = () => {
		platform.close();
		if (tempDir) rmSync(tempDir, { recursive: true, force: true });
	};

	const prepare: TestPreparation = {
		account: ({ id, role, name = id, email = `${id}@domus.test` }) =>
			prepareAccount(platform, { id, role, name, email }),
		password: (account, password) => preparePassword(platform, account, password),
		grant: (account, area, grant) => prepareGrant(platform, account, area, grant),
		delegation: (account, area, level, value) =>
			prepareDelegation(platform, account, area, level, value),
	};
	const context = (account: string, options: ContextOptions = {}) =>
		syntheticContext({
			account,
			device: "test-device",
			session: "test-session",
			deviceAccount: account,
			channel: "app",
			identity: "password",
			...options,
		});

	const door = createHttpHandler({
		platform,
		modules,
		auth: { secret: TEST_AUTH_SECRET, origins: [TEST_ORIGIN] },
	});

	return {
		platform,
		door,
		databaseFile,
		browser: () => createTestBrowser(door, TEST_ORIGIN),
		clock,
		prepare,
		deviceAccount: deviceAccountOf(platform),
		dbFor: (module) => moduleDatabase(platform, module),
		context,
		member: (id, options) => {
			if (!hasAccount(platform, id)) prepare.account({ id, role: "member" });
			return context(id, options);
		},
		invoke: (context, action, ...[input, options]) =>
			invokeAction(platform, {
				context,
				action,
				input,
				idempotencyKey: options?.idempotencyKey,
			}) as never,
		undo: (context, entry, { idempotencyKey }) =>
			undoEntry(platform, { context, entry, idempotencyKey }),
		delegation: (context, account) => readDelegationOf(platform, context, account),
		log: () => readLog(platform),
		close,
		[Symbol.asyncDispose]: () => Promise.resolve(close()),
	};
}

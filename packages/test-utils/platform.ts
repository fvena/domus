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
	confirmPending,
	createPlatformWithClock,
	type Delegated,
	type DelegationTable,
	deviceAccountOf,
	type Grant,
	hasAccount,
	hasSession,
	invokeAction,
	type IssuedProof,
	type LogEntry,
	type ModuleDatabase,
	moduleDatabase,
	type PermissionLevel,
	prepareAccount,
	prepareDelegation,
	prepareGrant,
	preparePassword,
	prepareSession,
	type ProvenOperation,
	readDelegationOf,
	readLog,
	readPendingConfirmations,
	rejectPending,
	requestProofOf,
	syntheticContext,
	type Acknowledgement,
	type Annotation,
	backgroundSettled,
	changeTask,
	controlledTimer,
	readRuns,
	readTasks,
	type ScheduledTask,
	type TaskRun,
	type TaskState,
	undoEntry,
	wakeBackground,
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
	/** A step-up proof of this exact operation, from {@link TestPlatform.requestProof}, when it is sensitive. */
	readonly proof?: string;
}

/** Changing an account's permission in an area, an operation of the platform. */
export interface PermissionChange {
	readonly account: string;
	readonly area: string;
	readonly level: Grant;
}

/** Changing one level of one area of an account's delegation, an operation of the platform. */
export interface DelegationChange {
	readonly account: string;
	readonly area: string;
	readonly level: PermissionLevel;
	readonly value: Delegated;
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
	/** The voice window and the expiry of a new pending confirmation, in milliseconds. Unset: 60 s and 24 h. */
	readonly confirmation?: { readonly window?: number; readonly expiry?: number };
	/**
	 * Scheduled tasks of the test, declared next to the platform's own and run by the same scheduler and engine.
	 * Their work is the test's, such as one that holds its job running until the test lets it end.
	 */
	readonly tasks?: readonly ScheduledTask[];
}

/**
 * The background of a test platform: the same scheduler and engine as production, on the test's clock. Nothing
 * runs until {@link start}; then moving the clock wakes what falls due, without real timers.
 */
export interface TestBackground {
	/** Starts the background, as `apps/api` does after opening the platform. */
	start(): void;
	/** Stops it: no new job, the running ones cancelled, and it settles once they ended. */
	stop(): Promise<void>;
	/** Wakes it now and settles once no job runs. */
	runDue(): Promise<void>;
	/** Settles once no job runs, also those a job's end started. */
	settled(): Promise<void>;
	/** A read-only snapshot of the log of runs of the scheduled tasks, oldest first. */
	runs(): readonly TaskRun[];
	/** A read-only snapshot of the state of every task with a row, declared or not, by id. */
	tasks(): readonly TaskState[];
	/** Pauses a declared task, as the admin's operation will. An undeclared one throws. */
	pause(task: string): void;
	/** Resumes a declared task: its next run from now, without catching up what it skipped. */
	resume(task: string): void;
	/** Sets the local `HH:MM` the admin chose for a declared task, or null for its default. */
	setTime(task: string, time: string | null): void;
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
	/**
	 * Opens a session of the account, as signing in would, on `device` or on a new device. Returns both ids, for
	 * a {@link TestPlatform.context} that comes with a real session: revoking it then ends what was born in it.
	 */
	session(
		account: string,
		device?: string,
	): { readonly session: string; readonly device: string };
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
	/**
	 * Starts at {@link TEST_START}, in milliseconds since the epoch. Setting or advancing it wakes the background,
	 * once started, for whatever fell due.
	 */
	readonly clock: TestClock;
	readonly background: TestBackground;
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
	 * Confirms the pending confirmation `id` through the platform's real operation: its operation is evaluated
	 * again and runs once. Returns a read's result, or a write's result and entry (or acknowledgement). Throws
	 * `NOT_FOUND` for one out of reach, and a `CONFLICT` with its reason when its window closed, it expired or
	 * it was already consumed or rejected.
	 */
	confirm(context: VerifiedContext, id: string, options?: { readonly proof?: string }): unknown;
	/** Rejects the pending confirmation `id` through the platform's real operation, with the same rules. */
	reject(context: VerifiedContext, id: string): void;
	/**
	 * Reads the delegation table of `account` through the platform's real operation: each registered area with
	 * its three levels, `no` where there is no row. Each person reads their own and the admin the device
	 * account's; anything else is thrown as `FORBIDDEN`. Via Kira it needs the platform's read delegated, and a
	 * delegation that asks is thrown as `CONFIRMATION_REQUIRED`.
	 */
	delegation(context: VerifiedContext, account: string): DelegationTable;
	/**
	 * Asks for a step-up proof of `operation` through the platform's real operation, giving the account's
	 * `password` (see {@link TestPreparation.password}). Throws `FORBIDDEN` with `reason: "wrong-password"` for a
	 * wrong one, `FORBIDDEN` for an identity not proven by password, and a bad request for an operation that is
	 * not sensitive.
	 */
	requestProof(
		context: VerifiedContext,
		password: string,
		operation: ProvenOperation,
	): Promise<IssuedProof>;
	/** Changes an account's permission in an area: only the admin, on a member or the device account, with a proof. */
	setPermission(
		context: VerifiedContext,
		change: PermissionChange,
		options: WriteOptions,
	): WriteOutcome;
	/** Changes one level of an account's delegation: one's own, or the device account's as admin, with a proof. */
	setDelegation(
		context: VerifiedContext,
		change: DelegationChange,
		options: WriteOptions,
	): WriteOutcome;
	/** Revokes another session of one's own, or of the device account as admin, with a proof. */
	revokeSession(context: VerifiedContext, session: string, options: WriteOptions): WriteOutcome;
	/**
	 * Revokes, as admin and with a proof, the device a session of the device account is on: every session on it
	 * ends, and so do the pending confirmations and proofs born there.
	 */
	revokeDevice(context: VerifiedContext, session: string, options: WriteOptions): WriteOutcome;
	/** True while the session exists. */
	hasSession(session: string): boolean;
	/**
	 * Reads the action log through the platform's real operation: the annotations of the represented account's
	 * own entries, in order, never their input or inverse. Via Kira it needs the platform's read delegated: a
	 * denial is thrown as `FORBIDDEN`, and a delegation that asks as `CONFIRMATION_REQUIRED`.
	 */
	readLog(context: VerifiedContext): readonly Annotation[];
	/**
	 * A read-only snapshot of the action log: every entry, in order, with its content even when expired. That
	 * exception is only for tests.
	 */
	log(): readonly LogEntry[];
	/**
	 * A read-only snapshot of every stored pending confirmation, each row as the platform keeps it, whatever its
	 * state. That exception is only for tests: it shows what is stored, such as that no secret is.
	 */
	pendingConfirmations(): readonly Readonly<Record<string, unknown>>[];
	/**
	 * Closes the platform and removes the temporary folder it created. Safe to call more than once. Throws while
	 * the background is active; disposing stops it first.
	 */
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
	confirmation,
	tasks,
}: TestPlatformOptions<TModules>): TestPlatform<TModules> {
	let tempDir: string | undefined;
	let databaseFile = file ?? ":memory:";
	if (databaseFile === true) {
		tempDir = mkdtempSync(join(tmpdir(), "domus-test-"));
		databaseFile = join(tempDir, "domus.db");
	}

	let now = TEST_START;
	const timer = controlledTimer(() => now);
	const clock: TestClock = {
		now: () => now,
		set: (instant) => {
			now = instant;
			timer.fire();
		},
		advance: (milliseconds) => {
			now += milliseconds;
			timer.fire();
		},
	};

	let platform: Platform;
	try {
		platform = createPlatformWithClock(
			{ databaseFile, modules, retention, confirmation },
			() => now,
			{ timer, ...(tasks === undefined ? {} : { tasks }) },
		);
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
		session: (account, device) => prepareSession(platform, account, device),
	};
	/** Runs one of the platform's sensitive operations through the real path of the actions. */
	const operate = (
		context: VerifiedContext,
		name: string,
		input: unknown,
		{ idempotencyKey, proof }: WriteOptions,
	) =>
		invokeAction(platform, {
			context,
			action: `platform.${name}`,
			input,
			idempotencyKey,
			...(proof === undefined ? {} : { proof }),
		}) as WriteOutcome;
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

	const background: TestBackground = {
		start: () => {
			platform.startBackground();
		},
		stop: () => platform.stopBackground(),
		runDue: () => {
			wakeBackground(platform);
			return backgroundSettled(platform);
		},
		settled: () => backgroundSettled(platform),
		runs: () => readRuns(platform),
		tasks: () => readTasks(platform),
		pause: (task) => changeTask(platform, task, { paused: true }),
		resume: (task) => changeTask(platform, task, { paused: false }),
		setTime: (task, time) => changeTask(platform, task, { time }),
	};

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
		background,
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
				...(options?.proof === undefined ? {} : { proof: options.proof }),
			}) as never,
		undo: (context, entry, { idempotencyKey, proof }) =>
			undoEntry(platform, {
				context,
				entry,
				idempotencyKey,
				...(proof === undefined ? {} : { proof }),
			}),
		confirm: (context, id, options) =>
			confirmPending(platform, {
				context,
				confirmation: id,
				...(options?.proof === undefined ? {} : { proof: options.proof }),
			}),
		reject: (context, id) => {
			rejectPending(platform, { context, confirmation: id });
		},
		delegation: (context, account) => readDelegationOf(platform, context, account),
		requestProof: (context, password, operation) =>
			requestProofOf(platform, context, { password, operation }),
		setPermission: (context, change, options) =>
			operate(context, "setPermission", change, options),
		setDelegation: (context, change, options) =>
			operate(context, "setDelegation", change, options),
		revokeSession: (context, session, options) =>
			operate(context, "revokeSession", { session }, options),
		revokeDevice: (context, session, options) =>
			operate(context, "revokeDevice", { session }, options),
		hasSession: (session) => hasSession(platform, session),
		readLog: (context) =>
			invokeAction(platform, {
				context,
				action: "platform.readLog",
			}) as readonly Annotation[],
		log: () => readLog(platform),
		pendingConfirmations: () => readPendingConfirmations(platform),
		close,
		[Symbol.asyncDispose]: async () => {
			await platform.stopBackground();
			close();
		},
	};
}

/**
 * The id of the pending confirmation that `call` answers with: it must throw `CONFIRMATION_REQUIRED`, and
 * anything else fails the test.
 */
export function pendingFrom(call: () => unknown): string {
	try {
		call();
	} catch (error) {
		const { code, data } = (error ?? {}) as {
			code?: unknown;
			data?: { confirmation?: unknown };
		};
		if (code === "CONFIRMATION_REQUIRED" && typeof data?.confirmation === "string")
			return data.confirmation;
		throw error;
	}
	throw new Error("expected CONFIRMATION_REQUIRED, but the call went through");
}

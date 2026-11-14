import { ORPCError } from "@orpc/server";
// What only test-utils takes from platform (ADR 0021, ADR 0022, ADR 0023): the Drizzle client of a module, behind
// dbFor; a platform with the real authorization and a clock the test chooses; the way to invoke its actions and
// undo their entries with a verified context; synthetic verified contexts; the privileged preparation of
// accounts, roles, passwords, permission rows, delegation rows and sessions, without a session or a proof; the
// platform's real read of a delegation table and real request of a step-up proof; a read of its action log
// and of its stored pending confirmations; and child processes that hold the platform open or the exclusive lock
// until the test kills them (ADR 0026); and a Node executable that stops the snapshot's child at its copy (ADR
// 0027). A rule of .dependency-cruiser.cjs keeps every other importer out, production code of platform included;
// the main entry offers none of it.
import { hashPassword } from "better-auth/crypto";

import {
	type ActionCall,
	type Clock,
	type ConfirmationCall,
	READ_DELEGATION,
	type UndoCall,
	type WriteOutcome,
} from "../actions";
import type { LogEntry } from "../audit";
import {
	type Delegated,
	type Grant,
	type PermissionLevel,
	type Role,
	sealContext,
	type VerifiedContext,
} from "../authorization";
import {
	type JobKind,
	type JobSnapshot,
	readJobs as readJobsOf,
	readTaskRuns,
	readTaskStates,
	type ScheduledTask,
	type TaskRun,
	type TaskState,
	type Timer,
} from "../background";
import type { BackupConfig, BackupMarks } from "../backups";
import { createMarkStore } from "../backups/marks";
import { listSnapshots, type SnapshotSummary } from "../backups/restore";
import type { Interleave } from "../files";
import {
	ensureDeviceAccount,
	insertAccount,
	type NewAccount,
	randomId,
	setGrant,
	setPasswordHash,
} from "../identity/accounts";
import { type DelegationTable, setDelegation } from "../identity/delegation";
import {
	type IssuedProof,
	type ProofRequest,
	requestProof,
	WrongPasswordError,
} from "../identity/proofs";
import {
	actionLogOf,
	actionsOf,
	areasOf,
	backgroundOf,
	clockOf,
	connectionOf,
	openPlatform,
	type Platform,
	type PlatformOptions,
	proofIssuerOf,
} from "../platform";

export type { Acknowledgement, ProvenOperation, WriteOutcome, WriteReceipt } from "../actions";
export type { IssuedProof, ProofRequest } from "../identity/proofs";
export type { Annotation, LogEntry } from "../audit";
export type { DelegationTable } from "../identity/delegation";
export type {
	Channel,
	Delegated,
	Grant,
	IdentityProof,
	PermissionLevel,
	Role,
	VerifiedContext,
} from "../authorization";
export { type ModuleDatabase, moduleDatabase } from "./module-database";
export { type ChildTask, startChild, type TestChild } from "./children";
export { type FakeNode, fakeNode, type FakeNodeOptions } from "./fake-node";
export { controlledTimer, type ControlledTimer } from "../background";
export type {
	JobContext,
	JobKind,
	JobSnapshot,
	ScheduledTask,
	TaskRun,
	TaskState,
} from "../background";
export { PermanentJobError } from "../background";
export { STOP_MARGIN } from "../background/engine";
export type { BackupMarks } from "../backups";
export type { Interleave, InterleavePoint } from "../files";
/** Where the store of a `files` folder keeps a content, by its hash: for tests that lay one out or remove it. */
export { contentPath } from "../files/store";
/**
 * `runRestore` restores with the runtime the test gives: its clock, the restic executable and, only here, the points
 * where the test cuts the exchange.
 */
export {
	MARKER as RESTORE_MARKER,
	type RestoreOptions,
	type RestorePoint,
	type RestoreResult,
	type RestoreRuntime,
	runRestore,
	type SnapshotSummary,
} from "../backups/restore";

/** The snapshots of host `domus` in the repository, oldest first, as `restore list` shows them. */
export function listSnapshotsOf(
	backups: BackupConfig,
	restic?: string,
): Promise<readonly SnapshotSummary[]> {
	return listSnapshots(backups, { clock: Date.now, ...(restic === undefined ? {} : { restic }) });
}

/** The backups' marks of a platform's database, as its row holds them. Plain data: changing it changes nothing. */
export function readBackupMarks(platform: Platform): BackupMarks {
	return createMarkStore(connectionOf(platform)).current();
}

/** What a test may give the background of its platform besides the clock. */
export interface TestBackgroundRuntime {
	/** How the background waits: a {@link controlledTimer} over the same clock, so no real timer runs. */
	readonly timer?: Timer;
	/** Scheduled tasks of the test, declared next to the platform's own. Not a contract for modules. */
	readonly tasks?: readonly ScheduledTask[];
	/** Synthetic job kinds of the test, by name, of either lane, that the test enqueues. Not a contract for modules. */
	readonly jobs?: Readonly<Record<string, JobKind>>;
	/** The restic executable of the backups, such as a fake one: `restic` from the `PATH` unless given. */
	readonly restic?: string;
	/** The Node executable of the backups' child processes, such as a fake one: this process's own unless given. */
	readonly node?: string;
	/**
	 * Where the platform tells the test it got to a point, such as a publication between its file and its rows, and
	 * waits until the promise the test returns settles. Only here.
	 */
	readonly interleave?: Interleave;
	/** The free bytes of the uploads' volume, as the test wants them: what `statfs` tells unless given. */
	readonly freeSpace?: () => number;
	/** Whether the next write of an upload's temporary file fails with `ENOSPC`. Only here. */
	readonly diskFull?: () => boolean;
}

/**
 * A platform like createPlatform's, with the real authorization, the clock the test gives it and, for its
 * background, the timer and extra tasks the test gives it.
 */
export function createPlatformWithClock(
	options: PlatformOptions,
	clock: Clock,
	{
		timer,
		tasks,
		jobs,
		restic,
		node,
		interleave,
		freeSpace,
		diskFull,
	}: TestBackgroundRuntime = {},
): Platform {
	return openPlatform(options, {
		clock,
		...(timer === undefined ? {} : { timer }),
		...(tasks === undefined ? {} : { tasks }),
		...(jobs === undefined ? {} : { jobs }),
		...(restic === undefined ? {} : { restic }),
		...(node === undefined ? {} : { node }),
		...(interleave === undefined ? {} : { interleave }),
		...(freeSpace === undefined ? {} : { freeSpace }),
		...(diskFull === undefined ? {} : { diskFull }),
	});
}

/** Wakes the platform's background now, as a due instant would: it enqueues the runs due and starts the jobs due. */
export function wakeBackground(platform: Platform): void {
	backgroundOf(platform).wake();
}

/** Settles once the platform's background runs no job, also those a job's end started. */
export function backgroundSettled(platform: Platform): Promise<void> {
	return backgroundOf(platform).settled();
}

/** Stores a job of a synthetic kind, due now, and wakes the background. Returns its id. */
export function enqueueJob(platform: Platform, kind: string): number {
	return backgroundOf(platform).enqueue(kind);
}

/** Every job of the background, oldest first. Plain data: changing it changes nothing. */
export function readJobs(platform: Platform): readonly JobSnapshot[] {
	return readJobsOf(connectionOf(platform));
}

/** Every run of a scheduled task, oldest first. Plain data: changing it changes nothing. */
export function readRuns(platform: Platform): readonly TaskRun[] {
	return readTaskRuns(connectionOf(platform));
}

/** The state of every scheduled task with a row, declared or not, by id. Plain data: changing it changes nothing. */
export function readTasks(platform: Platform): readonly TaskState[] {
	return readTaskStates(connectionOf(platform));
}

/**
 * Changes the state of a declared task as the operations of the platform's area will: pause, resume, or the time
 * the admin chose (null for its default). An undeclared task throws.
 */
export function changeTask(
	platform: Platform,
	task: string,
	change: { readonly paused: boolean } | { readonly time: string | null },
): void {
	const background = backgroundOf(platform);
	if ("time" in change) background.setTime(task, change.time);
	else if (change.paused) background.pause(task);
	else background.resume(task);
}

/** Runs an action through the platform's one path: validation, authorization, handler, result and, for a write, its log entry. */
export function invokeAction(platform: Platform, call: ActionCall): unknown {
	return actionsOf(platform).invoke(call);
}

/** Undoes an entry through the platform's one path: its stored inverse, the checks and one new log entry. */
export function undoEntry(platform: Platform, call: UndoCall): WriteOutcome {
	return actionsOf(platform).undo(call);
}

/** Confirms a pending confirmation through the platform's real operation, and returns what its operation does. */
export function confirmPending(platform: Platform, call: ConfirmationCall): unknown {
	return actionsOf(platform).confirm(call);
}

/** Rejects a pending confirmation through the platform's real operation. */
export function rejectPending(platform: Platform, call: ConfirmationCall): void {
	actionsOf(platform).reject(call);
}

/**
 * Every stored pending confirmation, as its row holds it, whatever its state, in the order they were born. Plain
 * data: changing it changes nothing.
 */
export function readPendingConfirmations(
	platform: Platform,
): readonly Readonly<Record<string, unknown>>[] {
	return connectionOf(platform)
		.prepare<[], Record<string, unknown>>(
			"SELECT * FROM platform_confirmations ORDER BY created_at, rowid",
		)
		.all();
}

/** Every entry of the action log, in order, with its content even when expired. A copy: changing it changes nothing. */
export function readLog(platform: Platform): readonly LogEntry[] {
	return actionLogOf(platform).entries();
}

/**
 * A verified context with any combination of its fields, such as a member recognized by voice on a device
 * signed in with the device account. Production builds one only from a session, at the door.
 */
export function syntheticContext(fields: VerifiedContext): VerifiedContext {
	return sealContext(fields);
}

/** Creates an account with its role, without a password. Returns its id. */
export function prepareAccount(
	platform: Platform,
	account: NewAccount & { readonly role: Exclude<Role, "device"> },
): string {
	return insertAccount(connectionOf(platform), account, areasOf(platform), clockOf(platform)());
}

/** True when an account with this id exists. */
export function hasAccount(platform: Platform, account: string): boolean {
	return (
		connectionOf(platform).prepare("SELECT 1 FROM platform_user WHERE id = ?").get(account) !==
		undefined
	);
}

/** Gives an account a password, hashed as Better Auth hashes it, so it can sign in over HTTP. */
export async function preparePassword(
	platform: Platform,
	account: string,
	password: string,
): Promise<void> {
	const hash = await hashPassword(password);
	setPasswordHash(connectionOf(platform), account, hash, clockOf(platform)());
}

/** Stores the row that replaces the default of the account's role in the area. */
export function prepareGrant(
	platform: Platform,
	account: string,
	area: string,
	grant: Grant,
): void {
	setGrant(connectionOf(platform), account, area, grant);
}

/** Stores one level of one area of the account's delegation, without a session or a proof. */
export function prepareDelegation(
	platform: Platform,
	account: string,
	area: string,
	level: PermissionLevel,
	value: Delegated,
): void {
	setDelegation(connectionOf(platform), account, area, level, value);
}

/**
 * Reads the delegation of `account` through the platform's real operation, `platform.readDelegation` on the path
 * of the actions: decided by its authorization, and via Kira with a delegation that asks it waits as a pending
 * confirmation.
 */
export function readDelegationOf(
	platform: Platform,
	context: VerifiedContext,
	account: string,
): DelegationTable {
	return actionsOf(platform).invoke({
		context,
		action: READ_DELEGATION,
		input: { account },
	}) as DelegationTable;
}

/**
 * Asks for a step-up proof through the platform's real operation: the password is checked as Better Auth does.
 * A wrong one is thrown as `FORBIDDEN` with `reason: "wrong-password"`, as the door answers it.
 */
export async function requestProofOf(
	platform: Platform,
	context: VerifiedContext,
	request: ProofRequest,
): Promise<IssuedProof> {
	try {
		return await requestProof(proofIssuerOf(platform), context, request);
	} catch (error) {
		if (error instanceof WrongPasswordError)
			throw new ORPCError("FORBIDDEN", { data: { reason: "wrong-password" } });
		throw error;
	}
}

/**
 * Opens a session of the account on a device, as signing in would, without a password: on the device given, or
 * on a new one. Returns the ids of both, for synthetic contexts that come with a real session.
 */
export function prepareSession(
	platform: Platform,
	account: string,
	device?: string,
): { readonly session: string; readonly device: string } {
	const connection = connectionOf(platform);
	const now = clockOf(platform)();
	const onDevice = device ?? randomId();
	connection
		.prepare("INSERT OR IGNORE INTO platform_devices (id, created_at) VALUES (?, ?)")
		.run(onDevice, now);
	const session = randomId();
	connection
		.prepare(
			"INSERT INTO platform_session (id, user_id, device_id, token, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
		)
		.run(session, account, onDevice, randomId(), now + 7 * 24 * 60 * 60 * 1000, now, now);
	return { session, device: onDevice };
}

/**
 * The session whose token a session cookie carries, with its account and device: what the door reads from a
 * request, for a test that uses a signed-in browser's session in an invocation. `undefined` when there is none.
 */
export function sessionOfToken(
	platform: Platform,
	token: string,
): { readonly session: string; readonly account: string; readonly device: string } | undefined {
	return connectionOf(platform)
		.prepare<[string], { session: string; account: string; device: string }>(
			"SELECT id AS session, user_id AS account, device_id AS device FROM platform_session WHERE token = ?",
		)
		.get(token);
}

/** True while a session with this id exists. */
export function hasSession(platform: Platform, session: string): boolean {
	return (
		connectionOf(platform)
			.prepare("SELECT 1 FROM platform_session WHERE id = ?")
			.get(session) !== undefined
	);
}

/** The instant the session with this id expires, as its row says; `undefined` when there is none. */
export function sessionExpiresAt(platform: Platform, session: string): number | undefined {
	return connectionOf(platform)
		.prepare<[string], { expiresAt: number }>(
			"SELECT expires_at AS expiresAt FROM platform_session WHERE id = ?",
		)
		.get(session)?.expiresAt;
}

/** The id of the one device account, which the platform created at start. */
export function deviceAccountOf(platform: Platform): string {
	return ensureDeviceAccount(connectionOf(platform), areasOf(platform), clockOf(platform)());
}

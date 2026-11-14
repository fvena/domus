// Files (ADR 0028): uploading and publishing a content in the store, which ends in a prepared file of the session
// that uploaded it. The door's route `POST /api/files` hands an upload here with its verified context; the bytes
// arrive as a stream, are written to a temporary file in `incoming/` while their SHA-256 and type are worked out,
// and are published under the lock of their hash so that an error never leaves a row without its synced file.
// module-sdk exposes none of it, and a dependency rule keeps modules out.
import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, openSync, readSync, rmSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";

import { ORPCError } from "@orpc/server";
import type Database from "better-sqlite3";

import type { Clock } from "../actions";
import { type AccessView, mayUpload, type VerifiedContext } from "../authorization";
import type { CleanupSweep } from "../background/cleanup";
import type { Timer } from "../background/timer";
import { randomId } from "../identity/accounts";
import { sessionLives } from "../identity/sessions";
import { contentSweeps } from "./cleanup";
import { fileError } from "./failures";
import { readFileName } from "./name";
import { createReservations, type FreeSpace } from "./reservations";
import { createFileStore, createHashLocks, type OpenedContent, syncToDisk } from "./store";
import { detectFileType, type FileDescription, type FileType } from "./type";

export { errorResponse } from "./failures";
export { markedFiles } from "./marked";
export {
	createReferences,
	FilesRefusal,
	type LiveReference,
	type References,
	type WriteRun,
} from "./references";
export { contentDisposition } from "./name";
export type { FreeSpace } from "./reservations";
export type { OpenedContent } from "./store";
export type { FileDescription, FileType } from "./type";

/** How many bytes of a content a download reads at a time. */
const CHUNK = 64 * 1024;

/** The largest upload, 25 MB, in bytes (ADR 0028). */
const MAX_SIZE = 25 * 1024 * 1024;

/** How long an upload may go without bytes, at any point, before it is given up: one minute. */
const IDLE_LIMIT = 60 * 1000;

/** How long a prepared file stays usable from the end of its preparation: 24 hours. */
const PREPARED_LIFETIME = 24 * 60 * 60 * 1000;

/** What an upload gives back: the prepared file, of the session that uploaded it. */
export interface PreparedFile extends FileDescription {
	/** Opaque and random: never the hash. */
	readonly id: string;
	readonly expiresAt: number;
}

/**
 * The points where the platform tells a test it got there and waits until the test lets it go: only the testing
 * entry gives one. `published`: the content's file is in its place, renamed or reused, and its rows are not yet
 * written. `claimed`: the cleanup marked a content claimed and let its lock go, and its file is not yet removed.
 * `removed`: the cleanup removed the file of a claimed content and synced its folder, and its row is not yet deleted.
 * `opened`: a download has its file open and its transaction ended, and no byte is sent yet.
 */
export type InterleavePoint = "published" | "claimed" | "removed" | "opened";

export type Interleave = (point: InterleavePoint) => Promise<void> | void;

export interface Files {
	/**
	 * Receives the upload of `request` for a verified context with a session and publishes it: the prepared file,
	 * or an ORPCError with the code of the spec's table.
	 */
	upload(context: VerifiedContext, request: Request): Promise<PreparedFile>;
	/**
	 * Opens the file of a present content for a download, inside the transaction that found it: its descriptor
	 * outlives a later deletion of the content. Throws when the file is missing, which should never happen.
	 */
	open(hash: string): OpenedContent;
	/** Empties the uploads in progress of an earlier process: before the door admits requests. */
	clearIncoming(): void;
	/** The cleanup's steps of the store, after its rows': they share the lock of each hash with publishing. */
	readonly sweeps: readonly CleanupSweep[];
	/** Where a download waits for a test, once its file is open: at once outside the testing entry. */
	opened(): Promise<void> | void;
	/**
	 * Closes the descriptor of every upload in progress, which then fails and removes its temporary file, and of
	 * every download still open, which then ends with an error.
	 */
	close(): void;
}

export interface FilesOptions {
	readonly connection: Database.Database;
	readonly clock: Clock;
	/** How an upload waits for its next bytes: the platform's timer, over the same clock. */
	readonly timer: Timer;
	readonly view: AccessView;
	/** The `files` folder: absolute. */
	readonly directory: string;
	readonly interleave?: Interleave;
	/** The free space of the volume of `directory`: `statfs` unless a test gives another. */
	readonly freeSpace?: FreeSpace;
	/** Only from the testing entry: whether the next write of a temporary file fails with `ENOSPC`. */
	readonly diskFull?: () => boolean;
}

/** A content received in full into its temporary file, synced to disk. */
interface Received {
	readonly temporary: string;
	readonly hash: string;
	readonly type: FileType;
	readonly size: number;
}

/** Who uploads: the account and the session the prepared file will be of, and the context they came in. */
interface Owner {
	readonly account: string;
	readonly session: string;
	readonly context: VerifiedContext;
}

/** An upload being received: its descriptor, open until it ends or the platform closes. */
interface Receiving {
	readonly descriptor: number;
	open: boolean;
	/** Why it was stopped before its body ended, if it was. */
	stopped?: unknown;
	/** Stops it at its next read with `failure`, the first one given. */
	stop(failure: unknown): void;
}

export function createFiles({
	connection,
	clock,
	timer,
	view,
	directory,
	interleave,
	freeSpace,
	diskFull,
}: FilesOptions): Files {
	const store = createFileStore(directory);
	const preparedHeld = connection.prepare<[string, number], { files: number; bytes: number }>(
		`SELECT count(*) AS files, coalesce(sum(contents.size), 0) AS bytes
		FROM platform_prepared_files AS prepared JOIN platform_file_contents AS contents ON contents.hash = prepared.content
		WHERE prepared.session = ? AND prepared.consumed = 0 AND prepared.expires_at > ?`,
	);
	const reservations = createReservations({
		directory: () => store.incoming(),
		prepared: (session) => preparedHeld.get(session, clock()) ?? { files: 0, bytes: 0 },
		...(freeSpace === undefined ? {} : { freeSpace }),
	});
	const locks = createHashLocks();
	const receiving = new Set<Receiving>();
	const serving = new Set<OpenedContent>();
	const lives = sessionLives(connection);
	const contentState = connection.prepare<[string], { state: "present" | "claimed" }>(
		"SELECT state FROM platform_file_contents WHERE hash = ?",
	);
	const insertContent = connection.prepare<[string, number, FileType, number]>(
		"INSERT INTO platform_file_contents (hash, size, type, state, created_at) VALUES (?, ?, ?, 'present', ?)",
	);
	const insertPrepared = connection.prepare<[string, string, string, string, string, number]>(
		"INSERT INTO platform_prepared_files (id, content, name, session, account, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
	);

	/**
	 * Writes the body to a temporary file while hashing it and detecting its type, until it ends with exactly the
	 * `declared` bytes. A minute without bytes, on the platform's clock and timer, stops it, as do the client's
	 * cancelling and the end of its session, checked at each chunk. On any failure what is left of the body is
	 * cancelled; the caller removes the file.
	 */
	async function receive(
		request: Request,
		{ owner, temporary, declared }: { owner: Owner; temporary: string; declared: number },
	): Promise<Received> {
		const reader = request.body?.getReader();
		const upload: Receiving = {
			descriptor: openSync(temporary, "wx"),
			open: true,
			stop: (failure) => {
				upload.stopped ??= failure;
				// The read it waits for ends now, and the upload fails without writing again.
				reader?.cancel().catch(() => undefined);
			},
		};
		receiving.add(upload);
		const cancelled = () => upload.stop(new Error("the client cancelled the upload"));
		request.signal.addEventListener("abort", cancelled, { once: true });
		if (request.signal.aborted) cancelled();
		try {
			const hash = createHash("sha256");
			const detector = detectFileType();
			let size = 0;
			for (;;) {
				const disarm = timer.at(clock() + IDLE_LIMIT, () =>
					upload.stop(fileError("UPLOAD_TIMEOUT")),
				);
				const chunk = await (
					reader?.read() ?? Promise.resolve({ done: true as const })
				).finally(disarm);
				if (upload.stopped !== undefined) throw upload.stopped;
				if (chunk.done) break;
				if (!lives(owner.account, owner.session, clock()))
					throw new ORPCError("UNAUTHORIZED");
				size += chunk.value.length;
				// Not a byte past the declared size reaches the disk: the reservation holds no more.
				if (size > declared) throw fileError("BODY_MISMATCH");
				hash.update(chunk.value);
				detector.push(chunk.value);
				if (diskFull?.()) throw noSpace();
				writeWhole(upload.descriptor, chunk.value);
			}
			if (size !== declared) throw fileError("BODY_MISMATCH");
			fsyncSync(upload.descriptor);
			const type = detector.finish();
			if (type === undefined) throw fileError("FILE_TYPE_NOT_ALLOWED");
			return { temporary, hash: hash.digest("hex"), type, size };
		} catch (error) {
			reader?.cancel().catch(() => undefined);
			throw error;
		} finally {
			request.signal.removeEventListener("abort", cancelled);
			if (upload.open) {
				upload.open = false;
				closeSync(upload.descriptor);
			}
			receiving.delete(upload);
		}
	}

	/**
	 * Publishes a received content under the lock of its hash: reuses a present one or a file left without a row,
	 * refuses a claimed one, or renames the temporary file into place and syncs its folders. Then, in one
	 * transaction, checks again that the session lives and its account may upload, and writes the rows.
	 */
	function publish(
		owner: Owner,
		name: string,
		{ temporary, hash, type, size }: Received,
	): Promise<PreparedFile> {
		return locks.hold(hash, async () => {
			const state = contentState.get(hash)?.state;
			if (state === "claimed") throw fileError("CONTENT_BUSY");
			const target = store.contentPath(hash);
			if (state === undefined && !existsSync(target)) {
				store.install(hash, temporary);
			} else if (state === undefined) {
				// A file without a row: a process killed before syncing it may have left it in memory only.
				syncToDisk(target);
				syncToDisk(dirname(target));
			}
			await interleave?.("published");
			return connection.transaction(() => {
				const now = clock();
				if (!lives(owner.account, owner.session, now)) throw new ORPCError("UNAUTHORIZED");
				if (!mayUpload(view, owner.context)) throw new ORPCError("FORBIDDEN");
				const current = contentState.get(hash)?.state;
				if (current === "claimed") throw fileError("CONTENT_BUSY");
				if (current === undefined) insertContent.run(hash, size, type, now);
				const prepared: PreparedFile = {
					id: randomId(),
					name,
					type,
					size,
					expiresAt: now + PREPARED_LIFETIME,
				};
				insertPrepared.run(
					prepared.id,
					hash,
					name,
					owner.session,
					owner.account,
					prepared.expiresAt,
				);
				return prepared;
			})();
		});
	}

	return {
		upload: async (context, request) => {
			const { session } = context;
			if (session === undefined) throw new ORPCError("UNAUTHORIZED");
			if (!mayUpload(view, context)) throw new ORPCError("FORBIDDEN");
			const size = declaredSize(request.headers.get("content-length"));
			const name = readFileName(request.headers.get("x-file-name") ?? undefined);
			if (name === undefined) throw fileError("INVALID_FILE_NAME");
			const id = randomUUID();
			const temporary = join(store.incoming(), id);
			const reservation = reservations.reserve({ session, temporary: id, size });
			const owner: Owner = { account: context.account, session, context };
			try {
				const received = await receive(request, { owner, temporary, declared: size });
				return await publish(owner, name.name, received);
			} catch (error) {
				throw isNoSpace(error) ? fileError("DISK_FULL") : error;
			} finally {
				// The temporary file goes before its reservation: one outside every reservation is left behind.
				rmSync(temporary, { force: true });
				reservation.release();
			}
		},
		open: (hash) => {
			const descriptor = openSync(store.contentPath(hash), "r");
			let open = true;
			const opened: OpenedContent = {
				stream: () =>
					new ReadableStream<Uint8Array>({
						pull: (controller) => {
							// Closed by the platform or a rollback: its number may be another's by now.
							if (!open) {
								controller.error(new Error("the download was closed"));
								return;
							}
							const chunk = new Uint8Array(CHUNK);
							const read = readSync(descriptor, chunk, 0, CHUNK, null);
							if (read === 0) {
								opened.close();
								controller.close();
							} else controller.enqueue(chunk.subarray(0, read));
						},
						cancel: () => opened.close(),
					}),
				close: () => {
					if (!open) return;
					open = false;
					serving.delete(opened);
					closeSync(descriptor);
				},
			};
			serving.add(opened);
			return opened;
		},
		clearIncoming: () => store.clearIncoming(),
		sweeps: contentSweeps({
			connection,
			store,
			locks,
			inProgress: (name) => reservations.holds(name),
			claimed: () => interleave?.("claimed"),
			removed: () => interleave?.("removed"),
		}),
		opened: () => interleave?.("opened"),
		close: () => {
			for (const opened of serving) opened.close();
			for (const upload of receiving) {
				upload.open = false;
				closeSync(upload.descriptor);
				// Its descriptor is gone, and its number may be another's: it fails without touching it again.
				upload.stop(new Error("the platform closed during the upload"));
			}
		},
	};
}

/** The size the request declares in `Content-Length`: from 1 byte to {@link MAX_SIZE}. */
function declaredSize(header: string | null): number {
	if (header === null || !/^\d+$/.test(header)) throw fileError("LENGTH_REQUIRED");
	const size = Number(header);
	if (size === 0) throw fileError("FILE_EMPTY");
	if (size > MAX_SIZE) throw fileError("FILE_TOO_LARGE");
	return size;
}

/** The error of a write that finds the volume full, as Node's own. */
function noSpace(): NodeJS.ErrnoException {
	return Object.assign(new Error("ENOSPC: no space left on device, write"), {
		code: "ENOSPC",
		syscall: "write",
	});
}

function isNoSpace(error: unknown): boolean {
	return error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOSPC";
}

/** Writes every byte of `chunk`: one write may take only part of it. */
function writeWhole(descriptor: number, chunk: Uint8Array): void {
	for (let written = 0; written < chunk.length;)
		written += writeSync(descriptor, chunk, written, chunk.length - written);
}

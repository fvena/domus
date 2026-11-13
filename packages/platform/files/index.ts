// Files (ADR 0028): uploading and publishing a content in the store, which ends in a prepared file of the session
// that uploaded it. The door's route `POST /api/files` hands an upload here with its verified context; the bytes
// arrive as a stream, are written to a temporary file in `incoming/` while their SHA-256 and type are worked out,
// and are published under the lock of their hash so that an error never leaves a row without its synced file.
// module-sdk exposes none of it, and a dependency rule keeps modules out.
import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, openSync, renameSync, rmSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";

import { ORPCError } from "@orpc/server";
import type Database from "better-sqlite3";

import type { Clock } from "../actions";
import { type AccessView, mayUpload, type VerifiedContext } from "../authorization";
import { randomId } from "../identity/accounts";
import { sessionLookup } from "../identity/sessions";
import { fileError } from "./failures";
import { readFileName } from "./name";
import { createFileStore, createHashLocks, syncFolder } from "./store";
import { detectFileType, type FileType } from "./type";

export { errorResponse } from "./failures";
export type { FileType } from "./type";

/** The largest upload, 25 MB, in bytes (ADR 0028). */
const MAX_SIZE = 25 * 1024 * 1024;

/** How long a prepared file stays usable from the end of its preparation: 24 hours. */
const PREPARED_LIFETIME = 24 * 60 * 60 * 1000;

/** What an upload gives back: the prepared file, of the session that uploaded it. */
export interface PreparedFile {
	/** Opaque and random: never the hash. */
	readonly id: string;
	readonly name: string;
	/** The type detected from the bytes, never the one the client declared. */
	readonly type: FileType;
	readonly size: number;
	readonly expiresAt: number;
}

/**
 * The points where the platform tells a test it got there and waits until the test lets it go: only the testing
 * entry gives one. `published`: the content's file is in its place, renamed or reused, and its rows are not yet
 * written.
 */
export type InterleavePoint = "published";

export type Interleave = (point: InterleavePoint) => Promise<void> | void;

export interface Files {
	/**
	 * Receives the upload of `request` for a verified context with a session and publishes it: the prepared file,
	 * or an ORPCError with the code of the spec's table.
	 */
	upload(context: VerifiedContext, request: Request): Promise<PreparedFile>;
	/** Empties the uploads in progress of an earlier process: before the door admits requests. */
	clearIncoming(): void;
	/** Closes the descriptor of every upload in progress, which then fails and removes its temporary file. */
	close(): void;
}

export interface FilesOptions {
	readonly connection: Database.Database;
	readonly clock: Clock;
	readonly view: AccessView;
	/** The `files` folder: absolute. */
	readonly directory: string;
	readonly interleave?: Interleave;
}

/** A content received in full into its temporary file, synced to disk. */
interface Received {
	readonly temporary: string;
	readonly hash: string;
	readonly type: FileType;
	readonly size: number;
}

/** An upload being received: its descriptor, open until it ends or the platform closes, and its body. */
interface Receiving {
	readonly descriptor: number;
	readonly reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
	open: boolean;
}

export function createFiles({
	connection,
	clock,
	view,
	directory,
	interleave,
}: FilesOptions): Files {
	const store = createFileStore(directory);
	const locks = createHashLocks();
	const receiving = new Set<Receiving>();
	const lookup = sessionLookup(connection);
	const contentState = connection.prepare<[string], { state: "present" | "claimed" }>(
		"SELECT state FROM platform_file_contents WHERE hash = ?",
	);
	const insertContent = connection.prepare<[string, number, FileType, number]>(
		"INSERT INTO platform_file_contents (hash, size, type, state, created_at) VALUES (?, ?, ?, 'present', ?)",
	);
	const insertPrepared = connection.prepare<[string, string, string, string, string, number]>(
		"INSERT INTO platform_prepared_files (id, content, name, session, account, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
	);

	/** Writes the body to a temporary file while hashing it and detecting its type; removes it on any failure. */
	async function receive(request: Request): Promise<Received> {
		const temporary = join(store.incoming(), randomUUID());
		const reader = request.body?.getReader();
		const upload: Receiving = { descriptor: openSync(temporary, "wx"), reader, open: true };
		receiving.add(upload);
		try {
			const hash = createHash("sha256");
			const detector = detectFileType();
			let size = 0;
			for (;;) {
				const chunk = reader ? await reader.read() : { done: true as const };
				// The platform closed while the bytes arrived: its descriptor is gone, and its number may be another's.
				if (!upload.open) throw new Error("the platform closed during the upload");
				if (chunk.done) break;
				hash.update(chunk.value);
				detector.push(chunk.value);
				writeWhole(upload.descriptor, chunk.value);
				size += chunk.value.length;
			}
			fsyncSync(upload.descriptor);
			const type = detector.finish();
			if (type === undefined) throw fileError("FILE_TYPE_NOT_ALLOWED");
			return { temporary, hash: hash.digest("hex"), type, size };
		} catch (error) {
			rmSync(temporary, { force: true });
			throw error;
		} finally {
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
	 * transaction, checks the session again and writes the rows.
	 */
	function publish(
		{ account, session }: { readonly account: string; readonly session: string },
		name: string,
		{ temporary, hash, type, size }: Received,
	): Promise<PreparedFile> {
		return locks.hold(hash, async () => {
			const state = contentState.get(hash)?.state;
			if (state === "claimed") throw fileError("CONTENT_BUSY");
			const target = store.contentPath(hash);
			if (state === undefined && !existsSync(target)) {
				store.ensureContentFolder(hash);
				renameSync(temporary, target);
				syncFolder(dirname(target));
			}
			await interleave?.("published");
			return connection.transaction(() => {
				if (lookup(session)?.account !== account) throw new ORPCError("UNAUTHORIZED");
				const now = clock();
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
				insertPrepared.run(prepared.id, hash, name, session, account, prepared.expiresAt);
				return prepared;
			})();
		});
	}

	return {
		upload: async (context, request) => {
			const { session } = context;
			if (session === undefined) throw new ORPCError("UNAUTHORIZED");
			if (!mayUpload(view, context)) throw new ORPCError("FORBIDDEN");
			declaredSize(request.headers.get("content-length"));
			const name = readFileName(request.headers.get("x-file-name") ?? undefined);
			if (name === undefined) throw fileError("INVALID_FILE_NAME");
			const received = await receive(request);
			try {
				return await publish({ account: context.account, session }, name.name, received);
			} finally {
				rmSync(received.temporary, { force: true });
			}
		},
		clearIncoming: () => store.clearIncoming(),
		close: () => {
			for (const upload of receiving) {
				upload.open = false;
				closeSync(upload.descriptor);
				// The read it waits for ends now, and the upload fails without touching the descriptor again.
				upload.reader?.cancel().catch(() => undefined);
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

/** Writes every byte of `chunk`: one write may take only part of it. */
function writeWhole(descriptor: number, chunk: Uint8Array): void {
	for (let written = 0; written < chunk.length;)
		written += writeSync(descriptor, chunk, written, chunk.length - written);
}

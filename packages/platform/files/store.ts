// The store of file contents on disk (ADR 0028, spec of phase 1d3, «Almacén de contenidos»): in the `files` folder
// of the data folder, the contents under `contents/`, spread by the first characters of their SHA-256, and the
// uploads in progress under `incoming/`, on the same volume so that publishing is a rename. A content is never
// rewritten: it is created, reused or deleted. Only `api` publishes or deletes, so one lock per hash inside the
// process is enough.
import { closeSync, fsyncSync, mkdirSync, openSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

/** How many characters of the hash name the folder a content lives in. */
const SPREAD = 2;

export interface FileStore {
	/** The folder of the uploads in progress, which exists once this returns. */
	incoming(): string;
	/** Where the content of `hash` lives, whether it exists or not. */
	contentPath(hash: string): string;
	/**
	 * Creates the folder of a content's path and every missing one above it, up to the store's own, and syncs each
	 * new folder's parent, so the new entry outlives a power cut. Returns the content's folder.
	 */
	ensureContentFolder(hash: string): string;
	/** Empties the uploads in progress: what `api` does before it admits requests. */
	clearIncoming(): void;
}

export function createFileStore(directory: string): FileStore {
	const contents = join(directory, "contents");
	const incoming = join(directory, "incoming");
	const contentPath = (hash: string) => join(contents, hash.slice(0, SPREAD), hash);

	return {
		incoming: () => {
			mkdirSync(incoming, { recursive: true });
			return incoming;
		},
		contentPath,
		ensureContentFolder: (hash) => {
			const folder = dirname(contentPath(hash));
			const first = mkdirSync(folder, { recursive: true });
			if (first !== undefined) {
				// Each folder created, from the deepest up to the first new one, is an entry of its parent's.
				for (let created = folder; ; created = dirname(created)) {
					syncFolder(dirname(created));
					if (created === first) break;
				}
			}
			return folder;
		},
		clearIncoming: () => {
			rmSync(incoming, { recursive: true, force: true });
		},
	};
}

/** Syncs a folder to disk, so the entries created or renamed in it outlive a power cut. */
export function syncFolder(folder: string): void {
	const descriptor = openSync(folder, "r");
	try {
		fsyncSync(descriptor);
	} finally {
		closeSync(descriptor);
	}
}

/** The in-memory locks of the contents, one per hash: whoever holds one is the only one publishing or deleting it. */
export interface HashLocks {
	/** Runs `work` once the hash is free, holding it until `work` settles, also when it throws. */
	hold<T>(hash: string, work: () => Promise<T>): Promise<T>;
}

export function createHashLocks(): HashLocks {
	const tails = new Map<string, Promise<void>>();
	return {
		hold: async (hash, work) => {
			const before = tails.get(hash) ?? Promise.resolve();
			let release!: () => void;
			const mine = new Promise<void>((resolve) => {
				release = resolve;
			});
			const tail = before.then(() => mine);
			tails.set(hash, tail);
			await before;
			try {
				return await work();
			} finally {
				release();
				if (tails.get(hash) === tail) tails.delete(hash);
			}
		},
	};
}

/** The open file of a content, until its bytes are sent or it is closed. */
export interface OpenedContent {
	/** Its bytes, from the start; the descriptor closes when they end or the stream is cancelled. */
	stream(): ReadableStream<Uint8Array>;
	/** Closes its descriptor, once; safe to call again. */
	close(): void;
}

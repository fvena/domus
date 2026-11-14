// The store of file contents on disk (ADR 0028, spec of phase 1d3, «Almacén de contenidos»): in the `files` folder
// of the data folder, the contents under `contents/`, spread by the first characters of their SHA-256, and the
// uploads in progress under `incoming/`, on the same volume so that publishing is a rename. A content is never
// rewritten: it is created, reused or deleted. Only `api` publishes or deletes, so one lock per hash inside the
// process is enough.
import {
	closeSync,
	existsSync,
	fsyncSync,
	mkdirSync,
	openSync,
	readdirSync,
	renameSync,
	rmSync,
} from "node:fs";
import { dirname, join } from "node:path";

/** The folder of the store in the data folder, unless the platform is given another. */
const FILES_FOLDER = "files";

/** The folder of the contents inside the store. */
const CONTENTS = "contents";

/** How many characters of the hash name the folder a content lives in. */
const SPREAD = 2;

/** A content's hash as the store names it: SHA-256 in lowercase hex. */
export const CONTENT_HASH = /^[0-9a-f]{64}$/;

/** The store's folder for a database on a file: `given`, or {@link FILES_FOLDER} beside the database. */
export function filesFolderOf(databaseFile: string, given?: string): string {
	return given ?? join(dirname(databaseFile), FILES_FOLDER);
}

/** Where the content of `hash` lives in the store of `directory`, whether it exists or not. */
export function contentPath(directory: string, hash: string): string {
	return join(directory, CONTENTS, hash.slice(0, SPREAD), hash);
}

export interface FileStore {
	/** The folder of the uploads in progress, which exists once this returns. */
	incoming(): string;
	/** Where the content of `hash` lives, whether it exists or not. */
	contentPath(hash: string): string;
	/**
	 * Renames the file `from`, already synced, into the place of the content `hash`, over whatever is there, and
	 * syncs its folder and every folder it had to create, so the new entry outlives a power cut. `from` must be on
	 * the same volume.
	 */
	install(hash: string, from: string): void;
	/**
	 * The path of every file in the folders of the contents (those named by the first characters of a hash), whatever
	 * its name and whether it has a row or not.
	 */
	stored(): string[];
	/** Empties the uploads in progress: what `api` does before it admits requests. */
	clearIncoming(): void;
}

export function createFileStore(directory: string): FileStore {
	const contents = join(directory, CONTENTS);
	const incoming = join(directory, "incoming");
	const pathOf = (hash: string) => contentPath(directory, hash);

	return {
		incoming: () => {
			mkdirSync(incoming, { recursive: true });
			return incoming;
		},
		contentPath: pathOf,
		install: (hash, from) => {
			const target = pathOf(hash);
			const folder = dirname(target);
			const first = mkdirSync(folder, { recursive: true });
			if (first !== undefined) {
				// Each folder created, from the deepest up to the first new one, is an entry of its parent's.
				for (let created = folder; ; created = dirname(created)) {
					syncToDisk(dirname(created));
					if (created === first) break;
				}
			}
			renameSync(from, target);
			syncToDisk(folder);
		},
		stored: () =>
			existsSync(contents)
				? readdirSync(contents, { withFileTypes: true })
						.filter((folder) => folder.isDirectory() && folder.name.length === SPREAD)
						.flatMap((folder) =>
							readdirSync(join(contents, folder.name), { withFileTypes: true })
								.filter((entry) => entry.isFile())
								.map((entry) => join(contents, folder.name, entry.name)),
						)
				: [],
		clearIncoming: () => {
			rmSync(incoming, { recursive: true, force: true });
		},
	};
}

/**
 * Syncs a file's bytes or a folder's entries to disk, so they outlive a power cut: for a folder, the entries created,
 * renamed or removed in it.
 */
export function syncToDisk(path: string): void {
	const descriptor = openSync(path, "r");
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

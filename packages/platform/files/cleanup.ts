// The cleanup of the store (ADR 0028, spec of phase 1d3, «Limpieza»): the steps of the daily cleanup that touch the
// disk, each a batch the cleanup repeats until one comes short. The rows that stop protecting a content (prepared
// files and released references) go before, in the cleanup's own statements; what is left here is the contents
// nothing points to any more, the claimed ones a cut pass left, the files left without a row and the temporary
// files no upload holds.
//
// Deleting a content: under the lock of its hash, one transaction checks that nothing points to it and marks it
// claimed; the lock goes, and the claim alone keeps a publication off it (one of that hash answers «busy»); then
// its file is removed and its folder synced; last, its row is deleted. A cut anywhere after the claim leaves it
// claimed, maybe without its file, and the next cleanup finishes it.
//
// A file of the store without a row (an orphan) is what a cut leaves between publishing a file and writing its row,
// or a restore cut after installing its contents. Publishing reuses it; past an hour, the cleanup deletes it. Both
// go under the lock of its hash, which the cleanup holds from checking that it still has no row and is that old
// until the file is gone, so a publication either finds it and writes its row first or writes its own after. Any
// other file in a folder of the contents (one the system or a cut left there, whatever its name) is no content's:
// past an hour, the cleanup deletes it by its own path, without a lock.
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import type Database from "better-sqlite3";

import type { CleanupSweep } from "../background/cleanup";
import { CONTENT_HASH } from "./needed";
import type { FileStore, HashLocks } from "./store";
import { syncToDisk } from "./store";

/** How long a file of the store may stay without a row before the cleanup deletes it: one hour. */
const ORPHAN_AGE = 60 * 60 * 1000;

/** A content nothing points to: no prepared file and no reference, live or released. */
const UNPOINTED = `NOT EXISTS (SELECT 1 FROM platform_prepared_files WHERE content = contents.hash)
	AND NOT EXISTS (SELECT 1 FROM platform_file_references WHERE content = contents.hash)`;

export interface ContentSweepsOptions {
	readonly connection: Database.Database;
	readonly store: FileStore;
	readonly locks: HashLocks;
	/** Whether a temporary file of `incoming/` is an upload's in progress. */
	readonly inProgress: (name: string) => boolean;
	/** Only from the testing entry: called once a content is claimed, before its file is removed. */
	readonly claimed?: () => Promise<void> | void;
	/** Only from the testing entry: called once a claimed content's file is removed, before its row is deleted. */
	readonly removed?: () => Promise<void> | void;
}

export function contentSweeps({
	connection,
	store,
	locks,
	inProgress,
	claimed,
	removed,
}: ContentSweepsOptions): readonly CleanupSweep[] {
	const unpointed = connection.prepare<[number], { hash: string }>(
		`SELECT hash FROM platform_file_contents AS contents WHERE state = 'present' AND ${UNPOINTED} LIMIT ?`,
	);
	const claim = connection.prepare<[string]>(
		`UPDATE platform_file_contents AS contents SET state = 'claimed'
		WHERE hash = ? AND state = 'present' AND ${UNPOINTED}`,
	);
	const leftClaimed = connection.prepare<[number], { hash: string }>(
		"SELECT hash FROM platform_file_contents WHERE state = 'claimed' LIMIT ?",
	);
	const forget = connection.prepare<[string]>(
		"DELETE FROM platform_file_contents WHERE hash = ? AND state = 'claimed'",
	);
	const hasRow = connection.prepare<[string], { found: 1 }>(
		"SELECT 1 AS found FROM platform_file_contents WHERE hash = ?",
	);

	/** The hash a file of the store holds the content of, when it is named and placed as one; else `undefined`. */
	function contentAt(path: string): string | undefined {
		const name = basename(path);
		return CONTENT_HASH.test(name) && store.contentPath(name) === path ? name : undefined;
	}

	/**
	 * Whether the file at `path` is left over: not the file of a content with a row, and last modified more than an
	 * hour before `now`.
	 */
	function leftOver(path: string, now: number): boolean {
		const hash = contentAt(path);
		if (hash !== undefined && hasRow.get(hash) !== undefined) return false;
		const modified = statSync(path, { throwIfNoEntry: false })?.mtimeMs;
		return modified !== undefined && now - modified > ORPHAN_AGE;
	}

	function removeLeftOver(path: string): void {
		rmSync(path, { force: true });
		syncToDisk(dirname(path));
	}

	/** Removes the file of a claimed content, if it still has one, and then its row. */
	async function finish(hash: string): Promise<void> {
		const path = store.contentPath(hash);
		rmSync(path, { force: true });
		if (existsSync(dirname(path))) syncToDisk(dirname(path));
		await removed?.();
		connection.transaction(() => forget.run(hash))();
	}

	return [
		// The contents nothing points to: each claimed under its lock, checked again there, then deleted.
		async (_now, batchSize) => {
			const found = unpointed.all(batchSize);
			for (const { hash } of found) {
				const won = await locks.hold(hash, async () =>
					connection.transaction(() => claim.run(hash).changes === 1)(),
				);
				if (!won) continue;
				await claimed?.();
				await finish(hash);
			}
			return found.length;
		},
		// The claimed contents of a pass that was cut, with or without their file.
		async (_now, batchSize) => {
			const found = leftClaimed.all(batchSize);
			for (const { hash } of found) await finish(hash);
			return found.length;
		},
		// The files without a row older than an hour, by their own path: one named as a content is checked again and
		// deleted under the lock of its hash; any other name is no content's, which no publication touches.
		async (now, batchSize) => {
			const found = store
				.stored()
				.filter((path) => leftOver(path, now))
				.slice(0, batchSize);
			for (const path of found) {
				const hash = contentAt(path);
				if (hash === undefined) removeLeftOver(path);
				else
					await locks.hold(hash, async () => {
						if (leftOver(path, now)) removeLeftOver(path);
					});
			}
			return found.length;
		},
		// The temporary files of `incoming/` no upload in progress holds: what a failed one left behind.
		async (_now, batchSize) => {
			const incoming = store.incoming();
			const left = readdirSync(incoming)
				.filter((name) => !inProgress(name))
				.slice(0, batchSize);
			for (const name of left) rmSync(join(incoming, name), { recursive: true, force: true });
			return left.length;
		},
	];
}

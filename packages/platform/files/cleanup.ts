// The cleanup of the store (ADR 0028, spec of phase 1d3, «Limpieza»): the steps of the daily cleanup that touch the
// disk, each a batch the cleanup repeats until one comes short. The rows that stop protecting a content (prepared
// files and released references) go before, in the cleanup's own statements; what is left here is the contents
// nothing points to any more, the claimed ones a cut pass left, and the temporary files no upload holds.
//
// Deleting a content: under the lock of its hash, one transaction checks that nothing points to it and marks it
// claimed; the lock goes, and the claim alone keeps a publication off it (one of that hash answers «busy»); then
// its file is removed and its folder synced; last, its row is deleted. A cut anywhere after the claim leaves it
// claimed, maybe without its file, and the next cleanup finishes it.
import { existsSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

import type Database from "better-sqlite3";

import type { CleanupSweep } from "../background/cleanup";
import type { FileStore, HashLocks } from "./store";
import { syncFolder } from "./store";

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
}

export function contentSweeps({
	connection,
	store,
	locks,
	inProgress,
	claimed,
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

	/** Removes the file of a claimed content, if it still has one, and then its row. */
	function finish(hash: string): void {
		const path = store.contentPath(hash);
		rmSync(path, { force: true });
		if (existsSync(dirname(path))) syncFolder(dirname(path));
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
				finish(hash);
			}
			return found.length;
		},
		// The claimed contents of a pass that was cut, with or without their file.
		async (_now, batchSize) => {
			const found = leftClaimed.all(batchSize);
			for (const { hash } of found) finish(hash);
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

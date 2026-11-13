// The snapshot's child process (ADR 0027) over a database file of its own temporary folder: the lock it holds while
// it copies, and what the copy keeps of the database.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";

import { realTimer } from "../background";
import { takeExclusiveLock } from "../lock";
import { fakeNode } from "../testing";
import { takeSnapshot } from "./snapshot";

const IN_USE = "the database is in use: stop api and accounts first";
const clockAndTimer = { clock: Date.now, timer: realTimer(Date.now) };

/** A temporary data folder with a database in WAL mode, as `api` keeps it, removed at the end of a `using` block. */
function dataFolder() {
	const dir = mkdtempSync(join(tmpdir(), "domus-snapshot-"));
	const databaseFile = join(dir, "domus.db");
	const db = new Database(databaseFile);
	db.pragma("journal_mode = WAL");
	return {
		dir,
		databaseFile,
		db,
		copy: join(dir, "copy.db"),
		[Symbol.dispose]: () => {
			db.close();
			rmSync(dir, { recursive: true, force: true });
		},
	};
}

describe("the snapshot's child", () => {
	it("holds the shared lock while it copies: restoring's exclusive lock is refused until it ended", async () => {
		using data = dataFolder();
		data.db.exec("CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT)");
		using node = fakeNode({ pause: true });

		const copied = takeSnapshot(
			data.databaseFile,
			data.copy,
			new AbortController().signal,
			clockAndTimer,
			node.executable,
		);
		await vi.waitFor(() => expect(node.pausedChild()).toBeDefined(), { timeout: 10_000 });

		expect(() => takeExclusiveLock(data.dir)).toThrow(IN_USE);
		node.resume();
		await copied;
		takeExclusiveLock(data.dir).release();
	});

	it("keeps the identifiers, the order of the implicit rowid and the AUTOINCREMENT sequences", async () => {
		using data = dataFolder();
		data.db.exec(`
			CREATE TABLE touched (entry INTEGER NOT NULL, id TEXT NOT NULL, PRIMARY KEY (entry, id));
			CREATE TABLE log (entry INTEGER PRIMARY KEY AUTOINCREMENT, body TEXT);
			INSERT INTO touched (entry, id) VALUES (1, 'c'), (1, 'a'), (1, 'b'), (2, 'z'), (2, 'b');
			DELETE FROM touched WHERE entry = 1 AND id = 'a';
			INSERT INTO touched (entry, id) VALUES (1, 'a');
			INSERT INTO log (body) VALUES ('one'), ('two'), ('three'), ('four');
			DELETE FROM log WHERE entry IN (2, 4);
		`);
		const read = (db: Database.Database) => ({
			touched: db.prepare("SELECT rowid, entry, id FROM touched ORDER BY entry, rowid").all(),
			log: db.prepare("SELECT entry, body FROM log ORDER BY entry").all(),
			sequences: db.prepare("SELECT name, seq FROM sqlite_sequence ORDER BY name").all(),
		});

		await takeSnapshot(
			data.databaseFile,
			data.copy,
			new AbortController().signal,
			clockAndTimer,
		);

		const copy = new Database(data.copy, { readonly: true });
		try {
			expect(read(copy)).toEqual({
				touched: [
					{ rowid: 1, entry: 1, id: "c" },
					{ rowid: 3, entry: 1, id: "b" },
					{ rowid: 6, entry: 1, id: "a" },
					{ rowid: 4, entry: 2, id: "z" },
					{ rowid: 5, entry: 2, id: "b" },
				],
				log: [
					{ entry: 1, body: "one" },
					{ entry: 3, body: "three" },
				],
				sequences: [{ name: "log", seq: 4 }],
			});
		} finally {
			copy.close();
		}
	});
});

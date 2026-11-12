import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { connectionOf, createPlatform } from "./platform";

describe("createPlatform", () => {
	let dir: string;
	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "domus-platform-"));
	});
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	it("opens a file in WAL mode with foreign keys on", () => {
		const platform = createPlatform({ databaseFile: join(dir, "domus.db"), modules: [] });
		const db = connectionOf(platform);
		expect(db.pragma("journal_mode", { simple: true })).toBe("wal");
		expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
		platform.close();
	});

	it("keeps what was written after closing and opening the same file again", () => {
		const databaseFile = join(dir, "domus.db");
		const first = createPlatform({ databaseFile, modules: [] });
		connectionOf(first).exec(
			"CREATE TABLE notes (body TEXT); INSERT INTO notes VALUES ('milk');",
		);
		first.close();

		const second = createPlatform({ databaseFile, modules: [] });
		expect(connectionOf(second).prepare("SELECT body FROM notes").pluck().all()).toEqual([
			"milk",
		]);
		second.close();
	});

	it("opens in memory with foreign keys on", () => {
		const platform = createPlatform({ databaseFile: ":memory:", modules: [] });
		expect(connectionOf(platform).pragma("foreign_keys", { simple: true })).toBe(1);
		platform.close();
	});

	it("fails on a file in a folder that does not exist, and creates nothing", () => {
		const databaseFile = join(dir, "missing", "domus.db");
		expect(() => createPlatform({ databaseFile, modules: [] })).toThrow();
		expect(existsSync(join(dir, "missing"))).toBe(false);
	});

	it("closes the connection when setting it up fails", () => {
		const databaseFile = join(dir, "domus.db");
		writeFileSync(databaseFile, "not a database, but long enough to have a header ".repeat(4));
		const close = vi.spyOn(Database.prototype, "close");
		try {
			expect(() => createPlatform({ databaseFile, modules: [] })).toThrow(/not a database/);
			expect(close).toHaveBeenCalledOnce();
			expect(close.mock.contexts[0]).toHaveProperty("open", false);
		} finally {
			close.mockRestore();
		}
	});

	it("can be closed more than once", () => {
		const platform = createPlatform({ databaseFile: join(dir, "domus.db"), modules: [] });
		platform.close();
		expect(() => platform.close()).not.toThrow();
		expect(connectionOf(platform).open).toBe(false);
	});

	it("rejects a relative path", () => {
		expect(() => createPlatform({ databaseFile: "data/domus.db", modules: [] })).toThrow(
			/absolute path/,
		);
	});

	it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
		"rejects a retention of %s milliseconds",
		(retention) => {
			expect(() =>
				createPlatform({ databaseFile: ":memory:", modules: [], retention }),
			).toThrow(/retention/);
		},
	);
});

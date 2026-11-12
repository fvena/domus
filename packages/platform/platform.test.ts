import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineModule } from "@domus/module-sdk";
import { readAction } from "@domus/module-sdk/contracts";
import { moduleTables } from "@domus/module-sdk/db";
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

	it("creates the one device account at start, without a password, and keeps it on the next start", () => {
		const databaseFile = join(dir, "domus.db");
		const accounts = (platform: ReturnType<typeof createPlatform>) =>
			connectionOf(platform)
				.prepare(
					"SELECT r.account, r.role, u.email, (SELECT count(*) FROM platform_account a WHERE a.user_id = u.id) AS credentials FROM platform_roles r JOIN platform_user u ON u.id = r.account",
				)
				.all();

		const first = createPlatform({ databaseFile, modules: [] });
		const created = accounts(first);
		first.close();
		const second = createPlatform({ databaseFile, modules: [] });

		expect(created).toEqual([
			{
				account: expect.any(String),
				role: "device",
				email: "device@domus.invalid",
				credentials: 0,
			},
		]);
		expect(accounts(second)).toEqual(created);
		expect(() =>
			connectionOf(second)
				.prepare(
					"INSERT INTO platform_user (id, name, email, created_at, updated_at) VALUES ('d2', 'Otro', 'd2@domus.invalid', 0, 0)",
				)
				.run(),
		).not.toThrow();
		// Exactly one device account: a second one is refused by the database itself.
		expect(() =>
			connectionOf(second)
				.prepare("INSERT INTO platform_roles (account, role) VALUES ('d2', 'device')")
				.run(),
		).toThrow(/UNIQUE/);
		second.close();
	});

	it("refuses to start with an action in an area that is not registered, before opening the file", () => {
		const databaseFile = join(dir, "domus.db");
		const notes = defineModule({
			id: "notes",
			schema: {},
			migrations: [],
			contract: { read: readAction({ area: "notes.health", level: "read" }) },
			actions: { read: () => undefined },
		});

		expect(() => createPlatform({ databaseFile, modules: [notes] })).toThrow(
			/area "notes.health", which is not registered/,
		);
		expect(existsSync(databaseFile)).toBe(false);
	});

	// Until the write capture checks every write to them (ticket 06), production cannot write owned tables.
	it("refuses a module with owned tables, before opening the file", () => {
		const databaseFile = join(dir, "domus.db");
		const notes = defineModule({
			id: "notes",
			schema: {
				items: moduleTables("notes").ownedTable(
					"items",
					{ type: "item", area: "notes" },
					{},
				),
			},
			migrations: [],
		});

		expect(() => createPlatform({ databaseFile, modules: [notes] })).toThrow(
			'module "notes": owned tables are not open to production until their writes are checked',
		);
		expect(existsSync(databaseFile)).toBe(false);
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

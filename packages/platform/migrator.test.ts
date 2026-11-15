import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineModule, type ModuleDefinition, type ModuleMigration } from "@domus/module-sdk";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readJobs } from "./background";
import { sessionEnabledWhere } from "./identity/sessions";
import { migrations as platformMigrations } from "./migrations";
import { migrate } from "./migrator";
import { connectionOf, createPlatform, type Platform } from "./platform";

/** A migration written by hand, as `pnpm db:generate` would carry it. */
function migration(position: number, tag: string, ...statements: string[]): ModuleMigration {
	return { tag, position, hash: `hash-of-${tag}`, statements };
}

const notesV1 = migration(
	0,
	"0000_notes",
	"CREATE TABLE `notes_items` (`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL, `body` text NOT NULL);",
);

/** Two tables, the second with a foreign key to the first. */
const shopV1 = migration(
	0,
	"0000_shop",
	"CREATE TABLE `shop_lists` (\n\t`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,\n\t`name` text NOT NULL\n);\n",
	"\nCREATE TABLE `shop_items` (\n\t`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,\n\t`list_id` integer NOT NULL,\n\t`body` text NOT NULL,\n\tFOREIGN KEY (`list_id`) REFERENCES `shop_lists`(`id`) ON UPDATE no action ON DELETE no action\n);\n",
);

/** A rebuild of `shop_lists`, the table `shop_items` points to, as drizzle-kit writes one, pragmas included. */
const shopV2 = migration(
	1,
	"0001_shop_archived",
	"PRAGMA foreign_keys=OFF;",
	"CREATE TABLE `__new_shop_lists` (\n\t`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,\n\t`name` text NOT NULL,\n\t`archived` integer DEFAULT false NOT NULL\n);\n",
	'INSERT INTO `__new_shop_lists`("id", "name") SELECT "id", "name" FROM `shop_lists`;',
	"DROP TABLE `shop_lists`;",
	"ALTER TABLE `__new_shop_lists` RENAME TO `shop_lists`;",
	"PRAGMA foreign_keys=ON;",
);

function shop(...migrations: ModuleMigration[]): ModuleDefinition {
	return defineModule({ id: "shop", schema: {}, migrations });
}

/** Everything a failed start must leave as it was, read on a connection of its own. */
function snapshot(databaseFile: string) {
	const db = new Database(databaseFile, { readonly: true, fileMustExist: true });
	try {
		const all = (sql: string) => db.prepare(sql).raw().all();
		return {
			schema: all("SELECT type, name, sql FROM sqlite_master ORDER BY name"),
			history: all("SELECT * FROM platform_migrations ORDER BY module, position"),
			lists: all("SELECT * FROM shop_lists ORDER BY id"),
			items: all("SELECT * FROM shop_items ORDER BY id"),
			sequences: all("SELECT * FROM sqlite_sequence ORDER BY name"),
		};
	} finally {
		db.close();
	}
}

/** Starts and expects it to fail with `message`, its connection closed and the data as it was before. */
function expectStartToFail(databaseFile: string, modules: ModuleDefinition[], message: RegExp) {
	const before = snapshot(databaseFile);
	const close = vi.spyOn(Database.prototype, "close");
	try {
		expect(() => createPlatform({ databaseFile, modules })).toThrow(message);
		// The lock's connection closes too; this is about the database's.
		const closed = close.mock.contexts.filter(
			(db) => (db as Database.Database).name === databaseFile,
		);
		expect(closed).toHaveLength(1);
		expect(closed[0]).toHaveProperty("open", false);
	} finally {
		close.mockRestore();
	}
	expect(snapshot(databaseFile)).toEqual(before);

	const fresh = new Database(databaseFile);
	try {
		expect(fresh.pragma("foreign_keys", { simple: true })).toBe(1);
	} finally {
		fresh.close();
	}
}

function history(platform: Platform) {
	return connectionOf(platform)
		.prepare("SELECT module, position, tag, hash FROM platform_migrations ORDER BY rowid")
		.raw()
		.all();
}

describe("migrations at start", () => {
	let dir: string;
	let databaseFile: string;
	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "domus-migrations-"));
		databaseFile = join(dir, "domus.db");
	});
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	it("applies every migration on a new database, and none the second time", () => {
		const notes = defineModule({ id: "notes", schema: {}, migrations: [notesV1] });

		const first = createPlatform({ databaseFile, modules: [notes] });
		expect(first.appliedMigrations).toBe(platformMigrations.length + 1);
		expect(history(first)).toEqual([
			["platform", 0, "0000_migration_history", expect.any(String)],
			["platform", 1, "0001_action_log", expect.any(String)],
			...platformMigrations
				.slice(2)
				.map(({ position, tag }) => ["platform", position, tag, expect.any(String)]),
			["notes", 0, "0000_notes", "hash-of-0000_notes"],
		]);
		connectionOf(first).prepare("INSERT INTO notes_items (body) VALUES ('milk')").run();
		first.close();

		const second = createPlatform({ databaseFile, modules: [notes] });
		expect(second.appliedMigrations).toBe(0);
		expect(history(second)).toHaveLength(platformMigrations.length + 1);
		expect(connectionOf(second).prepare("SELECT body FROM notes_items").pluck().all()).toEqual([
			"milk",
		]);
		second.close();
	});

	it("updates a database with data, rebuilding a table a foreign key points to", () => {
		const first = createPlatform({ databaseFile, modules: [shop(shopV1)] });
		connectionOf(first).exec(
			"INSERT INTO shop_lists (name) VALUES ('market'); INSERT INTO shop_items (list_id, body) VALUES (1, 'milk');",
		);
		first.close();

		const second = createPlatform({ databaseFile, modules: [shop(shopV1, shopV2)] });
		const db = connectionOf(second);
		expect(second.appliedMigrations).toBe(1);
		expect(db.prepare("SELECT id, name, archived FROM shop_lists").raw().all()).toEqual([
			[1, "market", 0],
		]);
		expect(db.prepare("SELECT list_id, body FROM shop_items").raw().all()).toEqual([
			[1, "milk"],
		]);
		expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
		expect(() =>
			db.prepare("INSERT INTO shop_items (list_id, body) VALUES (2, 'bread')").run(),
		).toThrow(/FOREIGN KEY/);
		second.close();
	});

	it.each([
		["its highest id", "DELETE FROM shop_lists WHERE id = 3"],
		["all its rows", "DELETE FROM shop_lists"],
	])("does not reuse ids of an AUTOINCREMENT table rebuilt after deleting %s", (_, deletion) => {
		const first = createPlatform({ databaseFile, modules: [shop(shopV1)] });
		connectionOf(first).exec(
			`INSERT INTO shop_lists (name) VALUES ('market'), ('pharmacy'), ('hardware'); ${deletion};`,
		);
		first.close();

		const second = createPlatform({ databaseFile, modules: [shop(shopV1, shopV2)] });
		const { id } = connectionOf(second)
			.prepare("INSERT INTO shop_lists (name) VALUES ('bakery') RETURNING id")
			.get() as { id: number };
		expect(id).toBe(4);
		second.close();
	});

	it("does not reuse ids in a migration that inserts after a rebuild in the same start", () => {
		const first = createPlatform({ databaseFile, modules: [shop(shopV1)] });
		connectionOf(first).exec(
			"INSERT INTO shop_lists (name) VALUES ('market'), ('pharmacy'), ('hardware'); DELETE FROM shop_lists WHERE id = 3;",
		);
		first.close();

		const shopV3 = migration(
			2,
			"0002_shop_bakery",
			"INSERT INTO `shop_lists` (`name`) VALUES ('bakery');",
		);
		const second = createPlatform({ databaseFile, modules: [shop(shopV1, shopV2, shopV3)] });
		expect(second.appliedMigrations).toBe(2);
		expect(
			connectionOf(second)
				.prepare("SELECT id FROM shop_lists WHERE name = 'bakery'")
				.pluck()
				.get(),
		).toBe(4);
		second.close();
	});

	it("does not reuse ids in a migration that inserts after its own rebuild", () => {
		const first = createPlatform({ databaseFile, modules: [shop(shopV1)] });
		connectionOf(first).exec(
			"INSERT INTO shop_lists (name) VALUES ('market'), ('pharmacy'), ('hardware'); DELETE FROM shop_lists WHERE id = 3;",
		);
		first.close();

		const rebuildAndInsert = migration(
			1,
			"0001_shop_archived_bakery",
			...shopV2.statements,
			"INSERT INTO `shop_lists` (`name`) VALUES ('bakery');",
		);
		const second = createPlatform({ databaseFile, modules: [shop(shopV1, rebuildAndInsert)] });
		expect(
			connectionOf(second)
				.prepare("SELECT id FROM shop_lists WHERE name = 'bakery'")
				.pluck()
				.get(),
		).toBe(4);
		second.close();
	});

	it("adds the outbox's columns to the jobs of a database of phase 1d3, each job kept without data or entry", () => {
		// Phase 1d3 ended with the platform's migration 0011.
		const phase1d3 = platformMigrations.filter(({ position }) => position <= 11);
		const before = new Database(databaseFile);
		migrate(before, [{ module: "platform", migrations: phase1d3 }]);
		before
			.prepare(
				`INSERT INTO platform_jobs (kind, lane, state, attempts, run_at, created_at, finished_at)
					VALUES ('cleanup', 'maintenance', 'done', 1, 0, 0, 0)`,
			)
			.run();
		before.close();

		const after = createPlatform({ databaseFile, modules: [] });
		expect(after.appliedMigrations).toBe(platformMigrations.length - phase1d3.length);
		expect(readJobs(connectionOf(after))).toEqual([
			{
				id: 1,
				kind: "cleanup",
				lane: "maintenance",
				state: "done",
				attempts: 1,
				runAt: 0,
				error: null,
				payload: null,
				entry: null,
				outcome: null,
			},
		]);
		after.close();
	});

	it("brings the subscriptions and the VAPID keys to a database of phase 1d3, its sessions kept and none enabled", () => {
		const phase1d3 = platformMigrations.filter(({ position }) => position <= 11);
		const before = new Database(databaseFile);
		migrate(before, [{ module: "platform", migrations: phase1d3 }]);
		before.exec(`
			INSERT INTO platform_user (id, name, email, created_at, updated_at) VALUES ('ana', 'Ana', 'ana@domus.test', 0, 0);
			INSERT INTO platform_devices (id, created_at) VALUES ('phone', 0);
			INSERT INTO platform_session (id, user_id, device_id, token, expires_at, created_at, updated_at)
				VALUES ('s1', 'ana', 'phone', 't1', 9999999999999, 0, 0);
		`);
		before.close();

		const after = createPlatform({ databaseFile, modules: [] });
		const connection = connectionOf(after);
		expect(
			connection
				.prepare(
					`SELECT s.id, ${sessionEnabledWhere("s.id")} AS enabled FROM platform_session s`,
				)
				.all(),
		).toEqual([{ id: "s1", enabled: 0 }]);
		expect(connection.prepare("SELECT count(*) FROM platform_push_keys").pluck().get()).toBe(1);
		expect(
			connection.prepare("SELECT count(*) FROM platform_push_subscriptions").pluck().get(),
		).toBe(0);
		after.close();
	});

	describe("when a start fails", () => {
		/** A database on shop 0000 and 0001, with a list and an item. */
		beforeEach(() => {
			const platform = createPlatform({ databaseFile, modules: [shop(shopV1, shopV2)] });
			connectionOf(platform).exec(
				"INSERT INTO shop_lists (name) VALUES ('market'); INSERT INTO shop_items (list_id, body) VALUES (1, 'milk');",
			);
			platform.close();
		});

		const shopV3 = migration(
			2,
			"0002_shop_notes",
			"ALTER TABLE `shop_items` ADD `note` text;",
			"UPDATE `shop_items` SET `note` = 'checked';",
		);

		it("applies none of the migrations when one fails behind a good one", () => {
			const broken = migration(
				3,
				"0003_shop_broken",
				"ALTER TABLE `shop_nothing` ADD `x` text;",
			);
			expectStartToFail(
				databaseFile,
				[shop(shopV1, shopV2, shopV3, broken)],
				/module "shop": migration "0003_shop_broken" failed: no such table: shop_nothing/,
			);
		});

		it("applies none of them when only the foreign key check finds the broken rows", () => {
			const orphan = migration(
				3,
				"0003_shop_orphan",
				"INSERT INTO `shop_items` (`list_id`, `body`) VALUES (99, 'bread');",
			);
			expectStartToFail(
				databaseFile,
				[shop(shopV1, shopV2, shopV3, orphan)],
				/foreign key: "shop_items" row 2 → "shop_lists"/,
			);
		});

		it("rejects a migration whose hash changed after it was applied", () => {
			expectStartToFail(
				databaseFile,
				[shop(shopV1, { ...shopV2, hash: "another-hash" }, shopV3)],
				/module "shop": migration "0001_shop_archived" was applied with another hash/,
			);
		});

		it("rejects an applied migration that is missing from the code", () => {
			expectStartToFail(
				databaseFile,
				[shop(shopV1)],
				/module "shop": migration "0001_shop_archived" is applied, but it is missing from the code/,
			);
		});

		it("rejects an applied migration that the code has in another place", () => {
			const before = migration(1, "0001_shop_first", "SELECT 1;");
			expectStartToFail(
				databaseFile,
				[shop(shopV1, before, { ...shopV2, position: 2 })],
				/module "shop": migration "0001_shop_archived" was applied at position 1, but the code has it at position 2/,
			);
		});

		it("rejects history rows of a module that is not in the list", () => {
			expectStartToFail(
				databaseFile,
				[],
				/module "shop": migration "0000_shop" is applied, but the module is not in the module list/,
			);
		});

		it("rejects the module definitions before opening the file", () => {
			const before = snapshot(databaseFile);
			expect(() =>
				createPlatform({
					databaseFile,
					modules: [defineModule({ id: "Shop", schema: {}, migrations: [] })],
				}),
			).toThrow(/module "Shop": the id must match/);
			expect(snapshot(databaseFile)).toEqual(before);
		});
	});
});

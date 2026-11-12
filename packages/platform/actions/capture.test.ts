// The write capture (ADR 0023): every row transition of an owned table during a write is checked before the
// write commits. A module written here, `chores`, runs whatever each test asks for in one write, so each rule
// and each way of writing has its case. A failure rolls back the change and its entry.
import { defineModule, type ModuleDatabase } from "@domus/module-sdk";
import { writeAction } from "@domus/module-sdk/contracts";
import { eq, moduleTables, sql, text } from "@domus/module-sdk/db";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { connectionOf, type Platform } from "../platform";
import {
	createPlatformWithClock,
	invokeAction,
	moduleDatabase,
	prepareAccount,
	prepareGrant,
	readLog,
	syntheticContext,
} from "../testing";

const areas = {
	/** Private by default; a public record is edited only by its owner. */
	chores: {},
	/** Public by default; anyone with `write` edits a public record. */
	"chores.board": { defaultVisibility: "public", publicEditable: true },
} as const;
const { ownedTable } = moduleTables("chores", areas);
const tasks = ownedTable("tasks", { type: "task", area: "chores" }, { body: text().notNull() });
const posts = ownedTable(
	"posts",
	{ type: "post", area: "chores.board" },
	{ body: text().notNull(), slug: text().unique() },
);
const schema = { tasks, posts };

const migrations = [
	{
		tag: "0000_chores",
		position: 0,
		hash: "hash-of-0000_chores",
		statements: [
			"CREATE TABLE `chores_tasks` (`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL, `body` text NOT NULL, `owner` text NOT NULL, `visibility` text NOT NULL);",
			"CREATE TABLE `chores_posts` (`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL, `body` text NOT NULL, `slug` text UNIQUE, `owner` text NOT NULL, `visibility` text NOT NULL);",
		],
	},
];

interface Touched {
	readonly type: string;
	readonly id: number;
}

/** What the next `chores.run` does: it writes, then returns the records it declares as touched. */
let script: (db: ModuleDatabase<typeof schema>) => readonly Touched[];

const chores = defineModule({
	id: "chores",
	areas,
	schema,
	migrations,
	contract: {
		run: writeAction({ undoable: false, level: "write" }).input(z.any()).output(z.any()),
	},
	actions: {
		run: ({ db }) => ({ result: undefined, touched: script(db) }),
	},
});

const NOW = Date.UTC(2026, 10, 12, 9, 30);

let platform: Platform | undefined;
afterEach(() => {
	platform?.close();
	platform = undefined;
});

/**
 * A platform with chores and the members Ana and Bea. Ana's private task 1 and public task 2, Bea's private
 * task 3 and public task 4; Bea's public post 1 and private post 2.
 */
function household() {
	platform = createPlatformWithClock({ databaseFile: ":memory:", modules: [chores] }, () => NOW);
	for (const id of ["ana", "bea"])
		prepareAccount(platform, { id, name: id, email: `${id}@domus.test`, role: "member" });
	const db = moduleDatabase(platform, chores);
	db.insert(tasks)
		.values([
			{ owner: "ana", visibility: "private", body: "fregar" },
			{ owner: "ana", visibility: "public", body: "barrer" },
			{ owner: "bea", visibility: "private", body: "planchar" },
			{ owner: "bea", visibility: "public", body: "tender" },
		])
		.run();
	db.insert(posts)
		.values([
			{ owner: "bea", visibility: "public", body: "turnos de cocina", slug: "cocina" },
			{ owner: "bea", visibility: "private", body: "borrador", slug: "borrador" },
		])
		.run();
	return db;
}

/** A synthetic context of the account, through the app. */
function contextOf(account: string) {
	return syntheticContext({
		account,
		device: "test-device",
		session: "test-session",
		deviceAccount: account,
		channel: "app",
		identity: "password",
	});
}

let keys = 0;

/** Runs `chores.run` as the account with what `write` does, under a fresh key. */
function write(account: string, does: typeof script) {
	script = does;
	keys += 1;
	return invokeAction(platform!, {
		context: contextOf(account),
		action: "chores.run",
		input: {},
		idempotencyKey: `k${keys}`,
	});
}

const internal = expect.objectContaining({ code: "INTERNAL_SERVER_ERROR" });
const forbidden = expect.objectContaining({ code: "FORBIDDEN" });

/** Runs a write that must fail with `error`, and checks that neither its change nor its entry stayed. */
function expectRolledBack(account: string, does: typeof script, error: unknown) {
	const db = moduleDatabase(platform!, chores);
	const before = { tasks: db.select().from(tasks).all(), posts: db.select().from(posts).all() };
	expect(() => write(account, does)).toThrow(error as Error);
	expect({ tasks: db.select().from(tasks).all(), posts: db.select().from(posts).all() }).toEqual(
		before,
	);
	expect(readLog(platform!)).toEqual([]);
}

describe("the write capture", () => {
	it("has its triggers on every owned table before the first action", () => {
		household();

		const triggers = connectionOf(platform!)
			.prepare("SELECT tbl_name FROM sqlite_temp_master WHERE type = 'trigger'")
			.pluck()
			.all();
		expect(new Set(triggers)).toEqual(new Set(["chores_tasks", "chores_posts"]));
		expect(triggers).toHaveLength(6);
	});

	it("commits a write that touches only one's own records, declared", () => {
		const db = household();

		write("ana", (db) => {
			const added = db
				.insert(tasks)
				.values({ owner: "ana", visibility: "private", body: "cocinar" })
				.returning()
				.get();
			db.update(tasks).set({ body: "fregar bien" }).where(eq(tasks.id, 1)).run();
			db.delete(tasks).where(eq(tasks.id, 2)).run();
			return [
				{ type: "task", id: added.id },
				{ type: "task", id: 1 },
				{ type: "task", id: 2 },
			];
		});

		expect(db.select({ id: tasks.id, body: tasks.body }).from(tasks).all()).toEqual([
			{ id: 1, body: "fregar bien" },
			{ id: 3, body: "planchar" },
			{ id: 4, body: "tender" },
			{ id: 5, body: "cocinar" },
		]);
		expect(readLog(platform!)).toHaveLength(1);
	});

	it("rejects inserting a record with another owner", () => {
		household();

		expectRolledBack(
			"ana",
			(db) => {
				const added = db
					.insert(tasks)
					.values({ owner: "bea", visibility: "private", body: "cocinar" })
					.returning()
					.get();
				return [{ type: "task", id: added.id }];
			},
			internal,
		);
	});

	it("rejects changing the owner, even when the same write restores it", () => {
		household();

		expectRolledBack(
			"ana",
			(db) => {
				db.update(tasks).set({ owner: "bea" }).where(eq(tasks.id, 1)).run();
				return [{ type: "task", id: 1 }];
			},
			internal,
		);
		expectRolledBack(
			"ana",
			(db) => {
				db.update(tasks).set({ owner: "bea" }).where(eq(tasks.id, 1)).run();
				db.update(tasks).set({ owner: "ana" }).where(eq(tasks.id, 1)).run();
				return [{ type: "task", id: 1 }];
			},
			internal,
		);
	});

	it("rejects changing the key", () => {
		household();

		expectRolledBack(
			"ana",
			(db) => {
				db.update(tasks).set({ id: 10 }).where(eq(tasks.id, 1)).run();
				return [
					{ type: "task", id: 1 },
					{ type: "task", id: 10 },
				];
			},
			internal,
		);
	});

	it("rejects editing or deleting another's private record", () => {
		household();

		expectRolledBack(
			"ana",
			(db) => {
				db.update(tasks).set({ body: "otro" }).where(eq(tasks.id, 3)).run();
				return [{ type: "task", id: 3 }];
			},
			internal,
		);
		expectRolledBack(
			"ana",
			(db) => {
				db.delete(posts).where(eq(posts.id, 2)).run();
				return [{ type: "post", id: 2 }];
			},
			internal,
		);
	});

	it("forbids editing or deleting another's public record where its area does not allow it", () => {
		household();

		expectRolledBack(
			"ana",
			(db) => {
				db.update(tasks).set({ body: "otro" }).where(eq(tasks.id, 4)).run();
				return [{ type: "task", id: 4 }];
			},
			forbidden,
		);
		expectRolledBack(
			"ana",
			(db) => {
				db.delete(tasks).where(eq(tasks.id, 4)).run();
				return [{ type: "task", id: 4 }];
			},
			forbidden,
		);
	});

	it("lets anyone with write edit and delete another's public record where its area allows it", () => {
		const db = household();

		write("ana", (db) => {
			db.update(posts).set({ body: "turnos de limpieza" }).where(eq(posts.id, 1)).run();
			return [{ type: "post", id: 1 }];
		});
		expect(db.select({ body: posts.body }).from(posts).where(eq(posts.id, 1)).get()).toEqual({
			body: "turnos de limpieza",
		});

		write("ana", (db) => {
			db.delete(posts).where(eq(posts.id, 1)).run();
			return [{ type: "post", id: 1 }];
		});
		expect(db.select().from(posts).where(eq(posts.id, 1)).all()).toEqual([]);
	});

	it("forbids editing another's public record without write in its area", () => {
		household();
		// The action asks for write in chores; the record's area is chores.board, where Ana only reads.
		prepareGrant(platform!, "ana", "chores.board", "read");

		expectRolledBack(
			"ana",
			(db) => {
				db.update(posts).set({ body: "otro" }).where(eq(posts.id, 1)).run();
				return [{ type: "post", id: 1 }];
			},
			forbidden,
		);
	});

	it("forbids changing the visibility of another's record, even where its area allows editing", () => {
		household();

		expectRolledBack(
			"ana",
			(db) => {
				db.update(posts).set({ visibility: "private" }).where(eq(posts.id, 1)).run();
				return [{ type: "post", id: 1 }];
			},
			forbidden,
		);
	});

	it("lets the owner change the visibility of its own record", () => {
		const db = household();

		write("bea", (db) => {
			db.update(tasks).set({ visibility: "public" }).where(eq(tasks.id, 3)).run();
			return [{ type: "task", id: 3 }];
		});

		expect(
			db.select({ visibility: tasks.visibility }).from(tasks).where(eq(tasks.id, 3)).get(),
		).toEqual({ visibility: "public" });
	});

	it("counts a record created and deleted in the same write as touched", () => {
		household();

		expectRolledBack(
			"ana",
			(db) => {
				const added = db
					.insert(tasks)
					.values({ owner: "ana", visibility: "private", body: "efímera" })
					.returning()
					.get();
				db.delete(tasks).where(eq(tasks.id, added.id)).run();
				return [];
			},
			internal,
		);
		write("ana", (db) => {
			const added = db
				.insert(tasks)
				.values({ owner: "ana", visibility: "private", body: "efímera" })
				.returning()
				.get();
			db.delete(tasks).where(eq(tasks.id, added.id)).run();
			return [{ type: "task", id: added.id }];
		});
	});

	it("checks every row of a statement that changes several", () => {
		household();

		// Every public task: Ana's 2 and Bea's 4.
		expectRolledBack(
			"ana",
			(db) => {
				db.update(tasks).set({ body: "hecho" }).where(eq(tasks.visibility, "public")).run();
				return [
					{ type: "task", id: 2 },
					{ type: "task", id: 4 },
				];
			},
			forbidden,
		);
		// Ana's own 1 and 2, only one of them declared.
		expectRolledBack(
			"ana",
			(db) => {
				db.update(tasks).set({ body: "hecho" }).where(eq(tasks.owner, "ana")).run();
				return [{ type: "task", id: 1 }];
			},
			internal,
		);
	});

	it("rejects a record changed without declaring it", () => {
		household();

		expectRolledBack(
			"ana",
			(db) => {
				db.update(tasks).set({ body: "otro" }).where(eq(tasks.id, 1)).run();
				return [{ type: "task", id: 2 }];
			},
			internal,
		);
		// The right id under another record type is not the same record.
		expectRolledBack(
			"ana",
			(db) => {
				db.update(tasks).set({ body: "otro" }).where(eq(tasks.id, 1)).run();
				return [{ type: "post", id: 1 }];
			},
			internal,
		);
	});

	it("checks an UPSERT that updates another's record", () => {
		household();

		expectRolledBack(
			"ana",
			(db) => {
				db.insert(tasks)
					.values({ id: 3, owner: "ana", visibility: "private", body: "mía" })
					.onConflictDoUpdate({ target: tasks.id, set: { body: "mía" } })
					.run();
				return [{ type: "task", id: 3 }];
			},
			internal,
		);
	});

	it("checks the row a REPLACE deletes", () => {
		household();

		// Same key: the old row of Bea goes, a new one of Ana takes its id.
		expectRolledBack(
			"ana",
			(db) => {
				db.run(
					sql`REPLACE INTO chores_tasks (id, owner, visibility, body) VALUES (3, 'ana', 'private', 'mía')`,
				);
				return [{ type: "task", id: 3 }];
			},
			internal,
		);
		// Another key: Bea's post with the same slug goes silently.
		expectRolledBack(
			"ana",
			(db) => {
				db.run(
					sql`INSERT OR REPLACE INTO chores_posts (owner, visibility, body, slug) VALUES ('ana', 'public', 'mía', 'borrador')`,
				);
				return [
					{ type: "post", id: 2 },
					{ type: "post", id: 3 },
				];
			},
			internal,
		);
	});

	it("starts empty on every write, also after one that rolled back", () => {
		household();

		expectRolledBack(
			"ana",
			(db) => {
				db.update(tasks).set({ body: "otro" }).where(eq(tasks.id, 1)).run();
				return [];
			},
			internal,
		);
		// The seed of household() wrote outside any write, and the failed one rolled back: neither is left over.
		write("ana", (db) => {
			db.update(tasks).set({ body: "fregar bien" }).where(eq(tasks.id, 1)).run();
			return [{ type: "task", id: 1 }];
		});
		write("bea", (db) => {
			db.update(tasks).set({ body: "planchar bien" }).where(eq(tasks.id, 3)).run();
			return [{ type: "task", id: 3 }];
		});

		expect(readLog(platform!)).toHaveLength(2);
	});
});

describe("a way of writing the capture does not cover", () => {
	it("rejects turning off recursive triggers, and turns them back on", () => {
		household();

		expectRolledBack(
			"ana",
			(db) => {
				db.run(sql`PRAGMA recursive_triggers = OFF`);
				db.run(
					sql`REPLACE INTO chores_tasks (id, owner, visibility, body) VALUES (3, 'ana', 'private', 'mía')`,
				);
				return [{ type: "task", id: 3 }];
			},
			internal,
		);
		expect(connectionOf(platform!).pragma("recursive_triggers", { simple: true })).toBe(1);
	});

	it("rejects changing the schema, such as dropping a trigger of the capture", () => {
		household();

		expectRolledBack(
			"ana",
			(db) => {
				const trigger = connectionOf(platform!)
					.prepare(
						"SELECT name FROM sqlite_temp_master WHERE type = 'trigger' AND tbl_name = 'chores_tasks' LIMIT 1",
					)
					.pluck()
					.get() as string;
				db.run(sql.raw(`DROP TRIGGER temp."${trigger}"`));
				db.update(tasks).set({ body: "otro" }).where(eq(tasks.id, 3)).run();
				return [{ type: "task", id: 3 }];
			},
			internal,
		);
	});

	it("rejects erasing rows of the capture", () => {
		household();

		expectRolledBack(
			"ana",
			(db) => {
				db.update(tasks).set({ body: "otro" }).where(eq(tasks.id, 3)).run();
				const capture = connectionOf(platform!)
					.prepare(
						"SELECT name FROM sqlite_temp_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
					)
					.pluck()
					.get() as string;
				db.run(sql.raw(`DELETE FROM temp."${capture}"`));
				return [{ type: "task", id: 3 }];
			},
			internal,
		);
	});
});

import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineModule } from "@domus/module-sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ScheduledTask } from "./background";
import { LOCK_FILE, takeExclusiveLock } from "./lock";
import { createPlatform, openPlatform } from "./platform";
import { startChild } from "./testing";

const IN_USE = "the database is in use: stop api and accounts first";
const RESTORING = "restore in progress";

/** Each file of the database in a folder, `domus.db` and its companions, with its bytes and modification time. */
function databaseFilesOf(
	folder: string,
): Record<string, { readonly bytes: string; readonly modified: number }> {
	return Object.fromEntries(
		readdirSync(folder)
			.filter((name) => name.startsWith("domus.db"))
			.map((name) => {
				const path = join(folder, name);
				return [
					name,
					{
						bytes: readFileSync(path).toString("base64"),
						modified: statSync(path).mtimeMs,
					},
				];
			}),
	);
}

describe("the lock of the database", () => {
	let dir: string;
	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "domus-lock-"));
	});
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	it("keeps the exclusive lock from being taken while a platform of the same process has the database open", () => {
		const platform = createPlatform({ databaseFile: join(dir, "domus.db"), modules: [] });

		expect(() => takeExclusiveLock(dir)).toThrow(IN_USE);

		platform.close();
		takeExclusiveLock(dir).release();
	});

	describe("is free again when opening fails after taking it", () => {
		it("on a damaged database", () => {
			const databaseFile = join(dir, "domus.db");
			writeFileSync(
				databaseFile,
				"not a database, but long enough to have a header ".repeat(4),
			);

			expect(() => createPlatform({ databaseFile, modules: [] })).toThrow(/not a database/);

			takeExclusiveLock(dir).release();
		});

		it("on a migration that fails", () => {
			const broken = defineModule({
				id: "notes",
				schema: {},
				migrations: [
					{
						tag: "0000_notes",
						position: 0,
						hash: "hash-of-0000_notes",
						statements: ["NOT SQL"],
					},
				],
			});

			expect(() =>
				createPlatform({ databaseFile: join(dir, "domus.db"), modules: [broken] }),
			).toThrow();

			takeExclusiveLock(dir).release();
		});

		it("on a background that cannot be built, such as a task declared twice", () => {
			const twice: ScheduledTask = {
				id: "cleanup",
				frequency: { every: "day", at: "04:30" },
				job: { lane: "maintenance", run: () => {} },
			};

			expect(() =>
				openPlatform(
					{ databaseFile: join(dir, "domus.db"), modules: [] },
					{ clock: Date.now, tasks: [twice] },
				),
			).toThrow(/declared twice/);

			takeExclusiveLock(dir).release();
		});

		it("on a database file that cannot be opened at all", () => {
			const databaseFile = join(dir, "domus.db");
			mkdirSync(databaseFile);

			expect(() => createPlatform({ databaseFile, modules: [] })).toThrow();

			takeExclusiveLock(dir).release();
		});
	});

	it("is not used by the platform in memory, which has no data folder", () => {
		const platform = createPlatform({ databaseFile: ":memory:", modules: [] });
		platform.close();

		expect(existsSync(join(process.cwd(), LOCK_FILE))).toBe(false);
	});

	describe("between processes", () => {
		it("keeps the exclusive lock from being taken while a child has the platform open", async () => {
			await using child = await startChild({ hold: "platform", dataDirectory: dir });

			expect(() => takeExclusiveLock(dir)).toThrow(IN_USE);
			void child;
		});

		it("keeps the platform from opening while a child holds the exclusive lock", async () => {
			await using child = await startChild({ hold: "exclusive", dataDirectory: dir });

			expect(() =>
				createPlatform({ databaseFile: join(dir, "domus.db"), modules: [] }),
			).toThrow(RESTORING);
			void child;
		});

		it("takes the lock before the data: refused, opening neither creates domus.db nor touches one there", async () => {
			const absent = mkdtempSync(join(tmpdir(), "domus-lock-"));
			const databaseFile = join(dir, "domus.db");
			createPlatform({ databaseFile, modules: [] }).close();
			const before = databaseFilesOf(dir);
			try {
				await using child = await startChild({ hold: "exclusive", dataDirectory: dir });
				await using other = await startChild({ hold: "exclusive", dataDirectory: absent });

				expect(() => createPlatform({ databaseFile, modules: [] })).toThrow(RESTORING);
				expect(() =>
					createPlatform({ databaseFile: join(absent, "domus.db"), modules: [] }),
				).toThrow(RESTORING);

				expect(databaseFilesOf(dir)).toEqual(before);
				expect(databaseFilesOf(absent)).toEqual({});
				void [child, other];
			} finally {
				rmSync(absent, { recursive: true, force: true });
			}
		});

		it("is freed when the child that had the platform open is killed with SIGKILL", async () => {
			const child = await startChild({ hold: "platform", dataDirectory: dir });
			expect(() => takeExclusiveLock(dir)).toThrow(IN_USE);

			await child.kill();

			takeExclusiveLock(dir).release();
		});

		it("is freed when the child that held the exclusive lock is killed with SIGKILL", async () => {
			const child = await startChild({ hold: "exclusive", dataDirectory: dir });
			const databaseFile = join(dir, "domus.db");
			expect(() => createPlatform({ databaseFile, modules: [] })).toThrow(RESTORING);

			await child.kill();

			createPlatform({ databaseFile, modules: [] }).close();
		});

		it("lets api and accounts have the database open at once", async () => {
			await using child = await startChild({ hold: "platform", dataDirectory: dir });

			const platform = createPlatform({ databaseFile: join(dir, "domus.db"), modules: [] });
			platform.close();
			void child;
		});

		it("tells the test when the child cannot hold its task, with the child's own message", async () => {
			const platform = createPlatform({ databaseFile: join(dir, "domus.db"), modules: [] });
			try {
				await expect(startChild({ hold: "exclusive", dataDirectory: dir })).rejects.toThrow(
					IN_USE,
				);
			} finally {
				platform.close();
			}
		});
	});
});

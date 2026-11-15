// A database of phase 1e, from before the connected apps were retired (ADR 0034), meets the code of now: opened, it
// takes the migration of phase 1f and keeps what the household needs; restored from a backup, the same. The database
// is prepared here with the migrator and the migrations up to phase 1e, never with the test platform, which would
// apply the current ones; only then is it opened or backed up with the real restic.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import probe from "@domus/probe/server";
import { createTestPlatform, requireRestic, restoreBackup, TEST_START } from "@domus/test-utils";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { migrations } from "../../packages/platform/migrations";
import { migrate } from "../../packages/platform/migrator";
import { schemaOf } from "./platform-migrations";

/** The last migration of the platform in phase 1e: what the Pi had applied before phase 1f. */
const LAST_OF_1E = "0016_complete_tomorrow_man";
const DAY = 24 * 60 * 60 * 1000;
/** restic derives its key on every open of the repository, which takes about a second each time. */
const RESTIC_TIMEOUT = 60_000;

/** The platform's migrations of phase 1e, by their tags. */
function migrationsOf1e() {
	const last = migrations.findIndex((migration) => migration.tag === LAST_OF_1E);
	expect(last).toBeGreaterThan(0);
	return migrations.slice(0, last + 1);
}

/** A temporary folder, removed at the end of a `using` block. */
function temporaryFolder() {
	const path = mkdtempSync(join(tmpdir(), "domus-phase-1e-"));
	return { path, [Symbol.dispose]: () => rmSync(path, { recursive: true, force: true }) };
}

/** A pending confirmation as phase 1e stored it, every column. */
function pendingOf1e(id: string, contextOnly: boolean) {
	return {
		id,
		account: "ana",
		via: null,
		kind: "write",
		operation: JSON.stringify({ action: "probe.addNote", input: { body: `from ${id}` } }),
		fingerprint: `fingerprint-of-${id}`,
		key: `key-of-${id}`,
		origin: JSON.stringify({
			account: "ana",
			device: "device-of-ana",
			session: "session-of-ana",
			deviceAccount: "ana",
			channel: contextOnly ? "contexto" : "app",
			identity: "password",
		}),
		session: null,
		bound: 0,
		created_at: TEST_START,
		window_closes_at: TEST_START + 60_000,
		expires_at: TEST_START + DAY,
		context_only: contextOnly ? 1 : 0,
		state: "pending",
		entry: null,
	};
}

/**
 * Writes on `file` a database of phase 1e, closed: the platform's migrations up to {@link LAST_OF_1E} and probe's,
 * the member `ana`, a note of hers and the `pending` confirmations given, each row as phase 1e wrote it.
 */
function databaseOf1e(
	file: string,
	{ notes = [], pending = [] }: { notes?: string[]; pending?: ReturnType<typeof pendingOf1e>[] },
): void {
	const db = new Database(file);
	try {
		migrate(db, [
			{ module: "platform", migrations: migrationsOf1e() },
			{ module: probe.id, migrations: probe.migrations },
		]);
		db.prepare(
			"INSERT INTO platform_user (id, name, email, email_verified, created_at, updated_at) VALUES ('ana', 'Ana', 'ana@domus.test', 0, ?, ?)",
		).run(TEST_START, TEST_START);
		db.prepare("INSERT INTO platform_roles (account, role) VALUES ('ana', 'member')").run();
		const note = db.prepare(
			"INSERT INTO probe_notes (body, owner, visibility) VALUES (?, 'ana', 'private')",
		);
		for (const body of notes) note.run(body);
		const confirmation = db.prepare(
			`INSERT INTO platform_confirmations (${Object.keys(pendingOf1e("", false)).join(", ")})
			VALUES (${Object.keys(pendingOf1e("", false))
				.map((column) => `@${column}`)
				.join(", ")})`,
		);
		for (const row of pending) confirmation.run(row);
	} finally {
		db.close();
	}
}

/** The schema of the database on `file`, as the comparison of {@link schemaOf} reads it. */
function schemaOn(file: string) {
	const db = new Database(file, { readonly: true, fileMustExist: true });
	try {
		return schemaOf(
			db
				.prepare<[], { sql: string }>(
					"SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY rowid",
				)
				.all()
				.map((row) => row.sql),
		);
	} finally {
		db.close();
	}
}

/** The tags of the platform's migrations applied on `file`, in order. */
function platformMigrationsOn(file: string): string[] {
	const db = new Database(file, { readonly: true, fileMustExist: true });
	try {
		return db
			.prepare<[], { tag: string }>(
				"SELECT tag FROM platform_migrations WHERE module = 'platform' ORDER BY position",
			)
			.all()
			.map((row) => row.tag);
	} finally {
		db.close();
	}
}

describe("a database of phase 1e opened with the code of now", () => {
	it("takes the migration of phase 1f and has the schema of a clean install", async () => {
		using folder = temporaryFolder();
		const of1e = join(folder.path, "of-1e.db");
		const clean = join(folder.path, "clean.db");
		databaseOf1e(of1e, {});

		{
			// The one migration of phase 1f.
			await using test = createTestPlatform({ modules: [probe], file: of1e });
			expect(test.platform.appliedMigrations).toBe(1);
		}
		createTestPlatform({ modules: [probe], file: clean }).close();

		expect(schemaOn(of1e)).toEqual(schemaOn(clean));
	});

	it("keeps an ordinary pending confirmation with its data and its expiry, and drops one only for contexto", async () => {
		using folder = temporaryFolder();
		const file = join(folder.path, "domus.db");
		const ordinary = pendingOf1e("ordinary", false);
		databaseOf1e(file, { pending: [ordinary, pendingOf1e("context-only", true)] });

		await using test = createTestPlatform({ modules: [probe], file });

		const { window_closes_at: _window, context_only: _contextOnly, ...kept } = ordinary;
		expect(test.pendingConfirmations()).toEqual([kept]);
		expect(test.pendingConfirmations()[0]?.expires_at).toBe(TEST_START + DAY);
	});
});

describe("a backup of phase 1e restored with the code of now", { timeout: RESTIC_TIMEOUT }, () => {
	it("opens with the migration of phase 1f applied and keeps the notes of probe", async () => {
		requireRestic();
		using folder = temporaryFolder();
		const data = join(folder.path, "data");
		const copy = join(folder.path, "copy");
		const repository = join(folder.path, "repository");
		for (const path of [data, copy, repository]) mkdirSync(path);
		const passwordFile = join(folder.path, "password");
		writeFileSync(passwordFile, randomBytes(24).toString("hex"), { mode: 0o600 });
		const backups = { repository, passwordFile };
		const file = join(data, "domus.db");

		// The live database, of now, with a note the backup does not hold.
		{
			await using test = createTestPlatform({ modules: [probe], file });
			test.invoke(
				test.member("ana"),
				"probe.addNote",
				{ body: "after" },
				{ idempotencyKey: "after" },
			);
		}

		// The backup of phase 1e: its database closed, at the root of a snapshot of host domus, as the nightly task
		// leaves it.
		databaseOf1e(join(copy, "domus.db"), { notes: ["one", "two"] });
		const restic = (...args: string[]) =>
			execFileSync("restic", [...args, "--no-cache"], {
				cwd: copy,
				env: {
					PATH: process.env.PATH,
					RESTIC_REPOSITORY: repository,
					RESTIC_PASSWORD_FILE: passwordFile,
				},
				stdio: "ignore",
			});
		restic("init");
		restic("backup", "--host", "domus", "--time", "2026-01-01 04:00:00", "domus.db");

		await restoreBackup({ file, modules: [probe], backups });

		await using test = createTestPlatform({ modules: [probe], file });
		expect(test.platform.appliedMigrations).toBe(0);
		expect(
			test.invoke(test.member("ana"), "probe.listNotes", {}).map((note) => note.body),
		).toEqual(["one", "two"]);
		expect(platformMigrationsOn(file)).toEqual(migrations.map((migration) => migration.tag));
	});
});

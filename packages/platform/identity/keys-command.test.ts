import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { connectionOf, createPlatform, openPlatform, type Platform } from "../platform";
import { checkKey, CONNECTED_APPS, parseKey } from "./keys";
import { parseKeysArguments, runKeys } from "./keys-command";

/** A terminal that keeps what goes to stdout and what goes to stderr apart. */
function fakeTerminal() {
	const stdout: string[] = [];
	const stderr: string[] = [];
	return {
		stdout,
		stderr,
		terminal: {
			print: (line: string) => stdout.push(`${line}\n`),
			inform: (line: string) => stderr.push(`${line}\n`),
			fail: (line: string) => stderr.push(`error: ${line}\n`),
		},
	};
}

/** Runs `args` against the platform as the wrapper does, parse then run. */
function run(platform: Platform, ...args: string[]) {
	const parsed = parseKeysArguments(args);
	if ("error" in parsed) throw new Error(parsed.error);
	const fake = fakeTerminal();
	const code = runKeys(platform, parsed.command, fake.terminal);
	return { code, stdout: fake.stdout.join(""), stderr: fake.stderr.join("") };
}

describe("runKeys", () => {
	let platform: Platform;
	beforeEach(() => {
		platform = createPlatform({ databaseFile: ":memory:", modules: [] });
	});
	afterEach(() => platform.close());

	describe("create", () => {
		it("writes to stdout the new key of kira alone, with its line break, and the key works", () => {
			const { code, stdout } = run(platform, "create", "kira");
			expect(code).toBe(0);
			expect(stdout).toMatch(/^domus_[A-Za-z0-9_-]{11}\.[A-Za-z0-9_-]{43}\n$/);
			const key = stdout.trimEnd();
			expect(parseKey(key)).toBeDefined();
			expect(checkKey(connectionOf(platform), CONNECTED_APPS, key)).toEqual({
				ok: true,
				id: parseKey(key)?.id,
				app: "kira",
			});
		});

		it("refuses an app outside the list with code 1, writing nothing to stdout and creating nothing", () => {
			const created = run(platform, "create", "voice-gateway");
			expect(created).toEqual({
				code: 1,
				stdout: "",
				stderr: "error: voice-gateway is not a connected app: use kira\n",
			});
			expect(run(platform, "list")).toMatchObject({ code: 0, stdout: "" });
		});

		it("never repeats an app that looks like a key", () => {
			const key = run(platform, "create", "kira").stdout.trimEnd();
			const created = run(platform, "create", key);
			expect(created.code).toBe(1);
			expect(created.stdout).toBe("");
			expect(created.stderr).toBe("error: that is not a connected app: use kira\n");
		});
	});
});

describe("runKeys on the platform clock", () => {
	const START = Date.UTC(2026, 10, 14, 9, 0, 0);
	let time: number;
	let platform: Platform;
	beforeEach(() => {
		time = START;
		platform = openPlatform({ databaseFile: ":memory:", modules: [] }, { clock: () => time });
	});
	afterEach(() => platform.close());

	function create(): { key: string; id: string } {
		const { stdout } = run(platform, "create", "kira");
		const key = stdout.trimEnd();
		return { key, id: parseKey(key)?.id ?? "" };
	}

	describe("list", () => {
		it("writes nothing to stdout without keys, and says so on stderr", () => {
			expect(run(platform, "list")).toEqual({
				code: 0,
				stdout: "",
				stderr: "no keys\n",
			});
		});

		it("writes one line per key, with its app, creation, last use or none, and whether it is revoked", () => {
			const first = create();
			time += 60_000;
			const second = create();
			time += 60_000;
			const third = create();
			// The door notes a key's last use (task 02); here it is prepared.
			connectionOf(platform)
				.prepare("UPDATE platform_keys SET last_used_at = ? WHERE id = ?")
				.run(START + 90_000, first.id);
			time += 60_000;
			run(platform, "revoke", second.id);

			const listed = run(platform, "list");
			expect(listed.code).toBe(0);
			expect(listed.stderr).toBe("");
			expect(listed.stdout).toBe(
				[
					`${first.id}  kira  created 2026-11-14T09:00:00.000Z  last used 2026-11-14T09:01:30.000Z  live`,
					`${second.id}  kira  created 2026-11-14T09:01:00.000Z  never used  revoked 2026-11-14T09:03:00.000Z`,
					`${third.id}  kira  created 2026-11-14T09:02:00.000Z  never used  live`,
					"",
				].join("\n"),
			);
			for (const { key } of [first, second, third])
				expect(listed.stdout).not.toContain(key.slice(key.indexOf(".")));
		});
	});

	describe("revoke", () => {
		it("revokes a live key, which no longer works, keeping its row, and leaves another key of the app alone", () => {
			const old = create();
			const other = create();
			time += 1_000;

			const revoked = run(platform, "revoke", old.id);
			expect(revoked).toEqual({
				code: 0,
				stdout: "",
				stderr: `revoked the key ${old.id} of kira\n`,
			});
			const connection = connectionOf(platform);
			expect(checkKey(connection, CONNECTED_APPS, old.key)).toEqual({
				ok: false,
				reason: "revoked",
			});
			expect(checkKey(connection, CONNECTED_APPS, other.key)).toMatchObject({ ok: true });
			expect(run(platform, "list").stdout).toContain(
				`${old.id}  kira  created 2026-11-14T09:00:00.000Z  never used  revoked 2026-11-14T09:00:01.000Z`,
			);
		});

		it("changes nothing for a key already revoked, and says so", () => {
			const { id } = create();
			run(platform, "revoke", id);
			const before = run(platform, "list").stdout;
			time += 60_000;

			expect(run(platform, "revoke", id)).toEqual({
				code: 0,
				stdout: "",
				stderr: `the key ${id} was already revoked at 2026-11-14T09:00:00.000Z: nothing changed\n`,
			});
			expect(run(platform, "list").stdout).toBe(before);
		});

		it("refuses an unknown id with code 1", () => {
			create();
			expect(run(platform, "revoke", "AbCdEfGh-_0")).toEqual({
				code: 1,
				stdout: "",
				stderr: "error: no key has the id AbCdEfGh-_0\n",
			});
		});
	});

	it("never writes a secret in an error", () => {
		const { key } = create();
		const secret = key.slice(key.indexOf(".") + 1);
		const failures = [
			run(platform, "create", key),
			run(platform, "create", secret),
			run(platform, "revoke", "AbCdEfGh-_0"),
		];
		platform.close();
		failures.push(run(platform, "list"), run(platform, "create", "kira"));
		for (const failure of failures) {
			expect(failure.code).toBe(1);
			expect(failure.stdout).toBe("");
			expect(failure.stderr).not.toContain(secret);
		}
	});
});

describe("runKeys on a file", () => {
	let dir: string;
	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "domus-keys-"));
	});
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	it("keeps only the hash: neither the database file nor its WAL holds the secret, before closing or after", () => {
		const databaseFile = join(dir, "domus.db");
		const platform = createPlatform({ databaseFile, modules: [] });
		const key = run(platform, "create", "kira").stdout.trimEnd();
		const secret = key.slice(key.indexOf(".") + 1);
		const holdsSecret = () =>
			readdirSync(dir)
				.filter((name) => name.startsWith("domus.db"))
				.some((name) => readFileSync(join(dir, name)).includes(secret));

		expect(readdirSync(dir)).toContain("domus.db-wal");
		expect(holdsSecret()).toBe(false);
		platform.close();
		expect(holdsSecret()).toBe(false);

		const reopened = createPlatform({ databaseFile, modules: [] });
		try {
			expect(checkKey(connectionOf(reopened), CONNECTED_APPS, key)).toMatchObject({
				ok: true,
			});
		} finally {
			reopened.close();
		}
	});
});

describe("parseKeysArguments", () => {
	it.each([
		[[], "keys needs a subcommand: create, list or revoke"],
		[["remove"], "unknown subcommand: use create, list or revoke"],
		[["create"], "create needs an app: kira"],
		[["create", "kira", "extra"], "create takes one app"],
		[["list", "extra"], "list takes no arguments"],
		[["revoke"], "revoke needs the id of a key, as list shows it"],
		[["revoke", "AbCdEfGh-_0", "extra"], "revoke takes one id"],
		[["revoke", "not-an-id"], "revoke needs the id of a key, as list shows it"],
	])("refuses %j: %s", (args, error) => {
		expect(parseKeysArguments(args)).toEqual({ error });
	});

	it("never repeats an argument that may be a key", () => {
		const key = `domus_AbCdEfGh-_0.${"a".repeat(42)}0`;
		for (const args of [["revoke", key], ["create", "kira", key], ["list", key], [key]]) {
			const parsed = parseKeysArguments(args);
			expect(parsed).toHaveProperty("error");
			expect(JSON.stringify(parsed)).not.toContain(key.slice(18));
		}
	});

	it.each([
		[["create", "kira"], { kind: "create", app: "kira" }],
		[["list"], { kind: "list" }],
		[["revoke", "AbCdEfGh-_0"], { kind: "revoke", id: "AbCdEfGh-_0" }],
	])("reads %j", (args, command) => {
		expect(parseKeysArguments(args)).toEqual({ command });
	});
});

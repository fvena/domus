import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readConfig } from "./config";

const SECRET = "s".repeat(32);
const base = {
	DOMUS_DATA_DIR: "/data",
	DOMUS_AUTH_SECRET: SECRET,
	DOMUS_ORIGINS: "http://kira.local:3000",
};

describe("readConfig", () => {
	it("puts the database in DOMUS_DATA_DIR", () => {
		const config = readConfig(base);
		expect(config.databaseFile).toBe("/data/domus.db");
	});

	it("refuses to start without DOMUS_DATA_DIR", () => {
		expect(() => readConfig({ ...base, DOMUS_DATA_DIR: undefined })).toThrow(
			/DOMUS_DATA_DIR is required/,
		);
	});

	it("refuses a relative DOMUS_DATA_DIR", () => {
		expect(() => readConfig({ ...base, DOMUS_DATA_DIR: "data" })).toThrow(
			/DOMUS_DATA_DIR must be an absolute path, got "data"/,
		);
	});

	it("reads the auth secret and the origins, separated by commas", () => {
		const config = readConfig({
			...base,
			DOMUS_ORIGINS: "http://kira.local:3000, https://kira.example.ts.net",
		});
		expect(config.auth).toEqual({
			secret: SECRET,
			origins: ["http://kira.local:3000", "https://kira.example.ts.net"],
		});
	});

	it.each([undefined, "", "too short"])(
		"refuses the auth secret %j without writing it",
		(secret) => {
			let message = "";
			try {
				readConfig({ ...base, DOMUS_AUTH_SECRET: secret });
			} catch (error) {
				message = (error as Error).message;
			}
			expect(message).toMatch(/DOMUS_AUTH_SECRET is required, with at least 32 characters/);
			if (secret) expect(message).not.toContain(secret);
		},
	);

	it.each([
		[undefined, /DOMUS_ORIGINS is required/],
		[" , ", /DOMUS_ORIGINS is required/],
		["kira.local", /"kira.local", which is not a URL/],
		["http://kira.local:3000/app", /write only the origin, such as http:\/\/kira.local:3000/],
	])("refuses the origins %j", (origins, message) => {
		expect(() => readConfig({ ...base, DOMUS_ORIGINS: origins })).toThrow(message);
	});
});

describe("readConfig of the backups", () => {
	let dir: string;
	let passwordFile: string;
	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "domus-config-"));
		passwordFile = join(dir, "backup-password");
		writeFileSync(passwordFile, PASSWORD, { mode: 0o600 });
	});
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	const PASSWORD = "a-password-for-the-backups";
	const on = () => ({
		...base,
		DOMUS_BACKUP_REPOSITORY: "/backups",
		DOMUS_BACKUP_PASSWORD_FILE: passwordFile,
	});
	/** The message readConfig throws with, or "" when it does not throw. */
	const messageOf = (env: NodeJS.ProcessEnv) => {
		try {
			readConfig(env);
			return "";
		} catch (error) {
			return (error as Error).message;
		}
	};

	it("leaves them off without the repository and the password file", () => {
		expect(readConfig(base).backups).toBeUndefined();
	});

	it("turns them on with both", () => {
		expect(readConfig(on()).backups).toEqual({ repository: "/backups", passwordFile });
	});

	it("leaves them off with the switch, even with both and an unreadable password file", () => {
		expect(readConfig({ ...on(), DOMUS_BACKUPS_OFF: "1" }).backups).toBeUndefined();
		expect(
			readConfig({
				...on(),
				DOMUS_BACKUP_PASSWORD_FILE: join(dir, "missing"),
				DOMUS_BACKUPS_OFF: "1",
			}).backups,
		).toBeUndefined();
	});

	it("refuses a switch that is not 1", () => {
		expect(messageOf({ ...on(), DOMUS_BACKUPS_OFF: "true" })).toMatch(
			/DOMUS_BACKUPS_OFF must be 1 or unset, got "true"/,
		);
	});

	it.each([
		["DOMUS_BACKUP_PASSWORD_FILE", "DOMUS_BACKUP_REPOSITORY"],
		["DOMUS_BACKUP_REPOSITORY", "DOMUS_BACKUP_PASSWORD_FILE"],
	])("refuses to start with %s missing and %s set, and names the missing one", (missing) => {
		expect(messageOf({ ...on(), [missing]: undefined })).toMatch(
			new RegExp(`^${missing} is required`),
		);
	});

	it.each(["DOMUS_BACKUP_REPOSITORY", "DOMUS_BACKUP_PASSWORD_FILE"])(
		"refuses a relative %s",
		(name) => {
			expect(messageOf({ ...on(), [name]: "backups" })).toMatch(
				new RegExp(`${name} must be an absolute path, got "backups"`),
			);
		},
	);

	it("refuses a password file it cannot read", () => {
		const missing = join(dir, "missing");
		expect(messageOf({ ...on(), DOMUS_BACKUP_PASSWORD_FILE: missing })).toMatch(
			/DOMUS_BACKUP_PASSWORD_FILE ".*missing" cannot be read/,
		);
		expect(messageOf({ ...on(), DOMUS_BACKUP_PASSWORD_FILE: dir })).toMatch(
			/DOMUS_BACKUP_PASSWORD_FILE ".*" cannot be read/,
		);
	});

	it.each(["", "\n"])("refuses an empty password file (%j)", (content) => {
		writeFileSync(passwordFile, content);
		expect(messageOf(on())).toMatch(/DOMUS_BACKUP_PASSWORD_FILE ".*" is empty/);
	});

	it("never writes the password in a message", () => {
		const messages = [
			messageOf({ ...on(), DOMUS_BACKUP_REPOSITORY: undefined }),
			messageOf({ ...on(), DOMUS_BACKUP_REPOSITORY: "backups" }),
		];
		for (const message of messages) {
			expect(message).not.toBe("");
			expect(message).not.toContain(PASSWORD);
		}
	});
});

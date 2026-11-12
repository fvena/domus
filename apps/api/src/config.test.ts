import { describe, expect, it } from "vitest";

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

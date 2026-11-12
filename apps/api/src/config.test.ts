import { describe, expect, it } from "vitest";

import { readConfig } from "./config";

describe("readConfig", () => {
	it("puts the database in DOMUS_DATA_DIR", () => {
		const config = readConfig({ DOMUS_DATA_DIR: "/data" });
		expect(config.databaseFile).toBe("/data/domus.db");
	});

	it("refuses to start without DOMUS_DATA_DIR", () => {
		expect(() => readConfig({})).toThrow(/DOMUS_DATA_DIR is required/);
	});

	it("refuses a relative DOMUS_DATA_DIR", () => {
		expect(() => readConfig({ DOMUS_DATA_DIR: "data" })).toThrow(
			/DOMUS_DATA_DIR must be an absolute path, got "data"/,
		);
	});
});

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTestPlatform } from "./platform";

describe("createTestPlatform", () => {
	it("runs in memory by default and answers through the door", async () => {
		await using test = createTestPlatform();
		expect(test.databaseFile).toBe(":memory:");
		const response = await test.door.fetch(new Request("http://domus/health"));
		expect(await response.json()).toEqual({ status: "ok" });
	});

	it("puts the file in a temporary folder it removes on close", () => {
		const test = createTestPlatform({ file: true });
		expect(existsSync(test.databaseFile)).toBe(true);
		test.close();
		expect(existsSync(dirname(test.databaseFile))).toBe(false);
	});

	it("removes its temporary folder at the end of an await using block", async () => {
		let databaseFile: string;
		{
			await using test = createTestPlatform({ file: true });
			databaseFile = test.databaseFile;
		}
		expect(existsSync(dirname(databaseFile))).toBe(false);
	});

	it("can be closed more than once, by close and by await using", async () => {
		await using test = createTestPlatform({ file: true });
		test.close();
		expect(() => test.close()).not.toThrow();
		await expect(test[Symbol.asyncDispose]()).resolves.toBeUndefined();
	});

	describe("on a file the caller gives", () => {
		let dir: string;
		beforeEach(() => {
			dir = mkdtempSync(join(tmpdir(), "domus-test-utils-"));
		});
		afterEach(() => rmSync(dir, { recursive: true, force: true }));

		it("uses it and keeps it after closing", () => {
			const databaseFile = join(dir, "domus.db");
			const test = createTestPlatform({ file: databaseFile });
			expect(test.databaseFile).toBe(databaseFile);
			test.close();
			expect(existsSync(databaseFile)).toBe(true);
		});
	});
});

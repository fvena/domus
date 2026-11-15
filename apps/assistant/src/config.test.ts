import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readConfig } from "./config";

const API = { DOMUS_API_URL: "http://api:3000" };

/** A key of the agreed form, built at run time: a literal one would stop the commit. */
const sampleKey = () =>
	`domus_${randomBytes(8).toString("base64url")}.${randomBytes(32).toString("base64url")}`;

describe("readConfig", () => {
	let directory: string;

	beforeEach(() => {
		directory = mkdtempSync(join(tmpdir(), "domus-assistant-config-"));
	});

	afterEach(() => {
		vi.restoreAllMocks();
		rmSync(directory, { recursive: true, force: true });
	});

	it("refuses to start without the api address", () => {
		expect(() => readConfig({})).toThrow(/DOMUS_API_URL/);
	});

	it("reads the key from its file, as `keys create` wrote it", () => {
		const key = sampleKey();
		const file = join(directory, "kira-key");
		writeFileSync(file, `${key}\n`);
		const config = readConfig({ ...API, DOMUS_API_KEY_FILE: file });
		expect(config.key).toBe(key);
		expect(config.keyFile).toBe(file);
	});

	it("looks for the key in the Docker secret by default", () => {
		expect(readConfig(API).keyFile).toBe("/run/secrets/kira-key");
	});

	it("starts without a key when its file is missing, empty or cannot be read, and prints nothing", () => {
		const log = vi.spyOn(console, "log");
		const warn = vi.spyOn(console, "warn");
		const error = vi.spyOn(console, "error");
		const empty = join(directory, "empty");
		writeFileSync(empty, "\n");

		// A directory where the file should be cannot be read, whoever runs the test.
		for (const file of [join(directory, "missing"), empty, directory]) {
			expect(readConfig({ ...API, DOMUS_API_KEY_FILE: file }).key).toBeUndefined();
		}
		expect([...log.mock.calls, ...warn.mock.calls, ...error.mock.calls]).toEqual([]);
	});
});

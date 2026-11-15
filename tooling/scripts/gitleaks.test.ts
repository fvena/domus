// The repository is public: a Domus API key that slips into a commit must stop at gitleaks, in the pre-commit hook
// and in CI. They read `.gitleaks.toml` at the root; this runs the real gitleaks with it over samples written outside
// the repository. No sample is ever literal here: each one is built at run time.
import { randomBytes } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { findGitleaks, type Gitleaks, pinnedImage } from "./gitleaks";

const root = join(import.meta.dirname, "../..");
const config = join(root, ".gitleaks.toml");

/** `bytes` random bytes in base64url, without padding, as the keys use them. */
function random(bytes: number): string {
	return randomBytes(bytes).toString("base64url");
}

/** A key of the form the platform issues: `domus_`, an 11-character id, a dot and a 43-character secret. */
function sampleKey(): string {
	return `domus_${random(8)}.${random(32)}`;
}

let gitleaks: Gitleaks;
let folder: string;

/** Writes each sample to its own file of the temporary folder and returns the files gitleaks flags, with the rule. */
function scan(samples: Record<string, string>): Record<string, string[]> {
	for (const [file, text] of Object.entries(samples))
		writeFileSync(join(folder, file), `${text}\n`);
	const found: Record<string, string[]> = {};
	for (const { file, rule } of gitleaks.scan(folder, config)) (found[file] ??= []).push(rule);
	return found;
}

describe("the gitleaks configuration", () => {
	// Through Docker, the first run downloads the image.
	beforeAll(() => {
		gitleaks = findGitleaks();
	}, 180_000);

	beforeEach(() => {
		folder = mkdtempSync(join(tmpdir(), "domus-gitleaks-"));
	});

	afterEach(() => {
		rmSync(folder, { recursive: true, force: true });
	});

	it("finds a Domus API key", () => {
		expect(scan({ "key.txt": sampleKey() })).toEqual({ "key.txt": ["domus-api-key"] });
	});

	it("finds a key inside a line, as in an environment file", () => {
		expect(scan({ "env.txt": `DOMUS_KIRA_KEY="${sampleKey()}"` })).toEqual({
			"env.txt": ["domus-api-key"],
		});
	});

	it("does not take a string with another prefix or a shorter secret for a key", () => {
		const key = sampleKey();
		expect(
			scan({
				"prefix.txt": key.replace(/^domus_/, "domux_"),
				"longer-prefix.txt": `x${key}`,
				"short.txt": key.slice(0, -1),
			}),
		).toEqual({});
	});

	it("keeps gitleaks' default rules", () => {
		// A GitHub token: `ghp_` and 36 letters or digits, here in hex.
		const token = `ghp_${randomBytes(18).toString("hex")}`;
		expect(scan({ "github.txt": token })).toEqual({ "github.txt": ["github-pat"] });
	});
});

describe("findGitleaks", () => {
	it("fails with what to install when there is neither gitleaks nor Docker", () => {
		expect(() =>
			findGitleaks({ gitleaks: "/nonexistent/gitleaks", docker: "/nonexistent/docker" }),
		).toThrow("gitleaks is required: start Docker, or install gitleaks 8.24.3");
	});

	it("does not take a gitleaks on PATH of another version than the pinned one", () => {
		const bin = mkdtempSync(join(tmpdir(), "domus-gitleaks-bin-"));
		try {
			const other = join(bin, "gitleaks");
			writeFileSync(other, "#!/bin/sh\necho 8.30.1\n");
			chmodSync(other, 0o755);
			expect(() => findGitleaks({ gitleaks: other, docker: "/nonexistent/docker" })).toThrow(
				"gitleaks is required",
			);
		} finally {
			rmSync(bin, { recursive: true, force: true });
		}
	});
});

describe("the pinned gitleaks", () => {
	it("is the same image in CI as in the pre-commit hook", () => {
		const workflow = readFileSync(join(root, ".github/workflows/validate-prs.yml"), "utf8");
		expect(workflow.match(/zricethezav\/gitleaks:\S+/g)).toEqual([pinnedImage()]);
	});
});

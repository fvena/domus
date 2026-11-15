// The repository is public: a secret that slips into a commit must stop at gitleaks, in the pre-commit hook and in
// CI. They read `.gitleaks.toml` at the root, which keeps gitleaks' default rules; this runs the real gitleaks with
// it over samples written outside the repository. No sample is ever literal here: each one is built at run time.
import { randomBytes } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { findGitleaks, type Gitleaks, pinnedImage } from "./gitleaks";

const root = join(import.meta.dirname, "../..");
const config = join(root, ".gitleaks.toml");

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

	it("loads, and flags nothing in a file without a secret", () => {
		expect(scan({ "notes.txt": "comprar pan y leche" })).toEqual({});
	});

	// So that loading means something: gitleaks stops on a configuration it cannot read.
	it("is a configuration gitleaks would refuse if it were malformed", () => {
		const elsewhere = mkdtempSync(join(tmpdir(), "domus-gitleaks-config-"));
		try {
			const broken = join(elsewhere, "broken.toml");
			writeFileSync(broken, `${readFileSync(config, "utf8")}\n[[rules]\n`);
			expect(() => gitleaks.scan(folder, broken)).toThrow();
		} finally {
			rmSync(elsewhere, { recursive: true, force: true });
		}
	});

	it("finds a secret by gitleaks' default rules, also inside a line, as in an environment file", () => {
		// A GitHub token: `ghp_` and 36 letters or digits, here in hex.
		const token = () => `ghp_${randomBytes(18).toString("hex")}`;
		expect(scan({ "github.txt": token(), "env.txt": `GITHUB_TOKEN="${token()}"` })).toEqual({
			"github.txt": ["github-pat"],
			"env.txt": ["github-pat"],
		});
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

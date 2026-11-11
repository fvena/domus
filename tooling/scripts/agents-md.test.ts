// Every AGENTS.md stays short and is visible to Claude Code through a sibling CLAUDE.md (docs/architecture/adr/0018).
import { existsSync, globSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "../..");
const ROOT_MAX_LINES = 80;
const FOLDER_MAX_LINES = 40;

const files = globSync("**/AGENTS.md", {
	cwd: root,
	exclude: (path) => /(^|\/)(node_modules|\.git|tooling\/scripts\/fixtures)$/.test(path),
});

describe("AGENTS.md", () => {
	it("exists at the root", () => {
		expect(files).toContain("AGENTS.md");
	});

	it.each(files)("%s stays under its size cap", (file) => {
		const lines = readFileSync(join(root, file), "utf8").trimEnd().split("\n").length;
		expect(lines).toBeLessThanOrEqual(file === "AGENTS.md" ? ROOT_MAX_LINES : FOLDER_MAX_LINES);
	});

	it.each(files)("%s has a CLAUDE.md that loads it", (file) => {
		const claude = join(root, dirname(file), "CLAUDE.md");
		expect(existsSync(claude) && readFileSync(claude, "utf8").trim()).toBe("@AGENTS.md");
	});
});

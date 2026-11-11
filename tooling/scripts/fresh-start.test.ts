// Domus starts from zero: no versioned file names the earlier trial, the starter it took its
// conventions from, or code carried over from elsewhere. Write each decision on its own merits.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, it } from "vitest";

const root = join(import.meta.dirname, "../..");

// Built from parts so this file does not match itself.
const BANNED = new RegExp(
	[
		"domus" + "-old",
		"super" + "starter",
		"trans" + "plant",
		"tras" + "plant",
		"kira" + "-v3",
	].join("|"),
	"i",
);

it("no versioned file refers to code from before the project", () => {
	const files = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" })
		.split("\n")
		.filter((file) => file && !file.endsWith("pnpm-lock.yaml"));
	const hits = files.filter((file) => BANNED.test(readFileSync(join(root, file), "utf8")));
	expect(hits).toEqual([]);
});

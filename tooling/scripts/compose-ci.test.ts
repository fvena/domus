// The CI job that starts the containers gives every variable docker-compose.yml requires (`${NAME:?…}`): compose
// refuses to start without one, and nothing else runs compose before CI does.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "../..");
const compose = readFileSync(join(root, "docker-compose.yml"), "utf8");
const workflow = readFileSync(join(root, ".github/workflows/validate-prs.yml"), "utf8");

const required = [...compose.matchAll(/\$\{([A-Z_][A-Z0-9_]*):\?/g)].map(([, name]) => name);

/** The `containers` job of the workflow, up to the next job at the same indentation. */
function containersJob(): string {
	const start = workflow.search(/^ {4}containers:$/m);
	if (start === -1) return "";
	const rest = workflow.slice(start + 1);
	const next = rest.search(/^ {4}[a-z][\w-]*:$/m);
	return next === -1 ? rest : rest.slice(0, next);
}

describe("docker-compose.yml in CI", () => {
	it("has a containers job", () => {
		expect(containersJob()).not.toBe("");
	});

	it.each(required)("the containers job sets %s", (name) => {
		expect(containersJob()).toMatch(new RegExp(`\\b${name}(=|:)`));
	});
});

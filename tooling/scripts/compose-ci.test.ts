// docker-compose.yml starts only api (ADR 0034), and CI builds and starts the images compose starts, giving every
// variable compose requires (`${NAME:?…}`): compose refuses to start without one, and nothing else runs compose
// before CI does.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "../..");
const compose = readFileSync(join(root, "docker-compose.yml"), "utf8");
const workflow = readFileSync(join(root, ".github/workflows/validate-prs.yml"), "utf8");

const required = [...compose.matchAll(/\$\{([A-Z_][A-Z0-9_]*):\?/g)].map(([, name]) => name);
const read = new Set([...compose.matchAll(/\$\{([A-Z_][A-Z0-9_]*)/g)].map(([, name]) => name));

/** The lines of `text` under the line `header`, up to the next line at the same indentation or less. */
function blockOf(text: string, header: RegExp): string {
	const match = header.exec(text);
	if (!match) return "";
	const indent = match[0].length - match[0].trimStart().length;
	const rest = text.slice(match.index + match[0].length);
	const next = rest.search(new RegExp(`^ {0,${indent}}\\S`, "m"));
	return next === -1 ? rest : rest.slice(0, next);
}

/** The keys of a block at `indent` spaces. */
function keysOf(block: string, indent: number): string[] {
	return [...block.matchAll(new RegExp(`^ {${indent}}([a-z][\\w-]*):`, "gm"))].map(
		([, key]) => key,
	);
}

/** The `containers` job of the workflow. */
const containersJob = blockOf(workflow, /^ {4}containers:$/m);

describe("docker-compose.yml", () => {
	it("starts only api", () => {
		expect(keysOf(blockOf(compose, /^services:$/m), 4)).toEqual(["api"]);
	});

	it("mounts only the backups' password as a secret", () => {
		expect(keysOf(blockOf(compose, /^secrets:$/m), 4)).toEqual(["backup-password"]);
	});
});

describe("docker-compose.yml in CI", () => {
	it("builds only the images compose starts", () => {
		const built = [...workflow.matchAll(/--target[ =](\S+)/g)].map(([, target]) => target);
		const started = [...compose.matchAll(/^ +target: (\S+)$/gm)].map(([, target]) => target);
		expect(built).toEqual(started);
	});

	it("has a containers job", () => {
		expect(containersJob).not.toBe("");
	});

	it.each(required)("the containers job sets %s", (name) => {
		expect(containersJob).toMatch(new RegExp(`\\b${name}(=|:)`));
	});

	it("the containers job sets only variables compose reads", () => {
		const set = [...containersJob.matchAll(/echo "([A-Z_][A-Z0-9_]*)=/g)].map(
			([, name]) => name,
		);
		expect(set.filter((name) => !read.has(name))).toEqual([]);
	});
});

// The secret scan of the pre-commit hook, run by real commits in throwaway repositories: from the main checkout and
// from a git worktree, whose .git is a file naming a folder outside it. Each way the hook can scan, through the
// gitleaks on PATH or through the pinned Docker image, runs where it is available. The other gates of the hook (lint,
// format, types) answer through a stand-in pnpm. No sample secret is ever literal here: each one is built at run time.
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { dockerRuns, findGitleaks, isPinnedGitleaks } from "./gitleaks";

const root = join(import.meta.dirname, "../..");

/** A key of the form the platform issues, which the rule of `.gitleaks.toml` flags. */
function sampleKey(): string {
	const random = (bytes: number) => randomBytes(bytes).toString("base64url");
	return `domus_${random(8)}.${random(32)}`;
}

/** A way for the hook to scan: what the stand-in folder at the head of PATH holds to make it take that way. */
interface Route {
	name: string;
	stubs: Record<string, string>;
}

const pnpm = "#!/bin/sh\nexit 0\n";
const routes: Route[] = [
	...(isPinnedGitleaks() ? [{ name: "the gitleaks on PATH", stubs: { pnpm } }] : []),
	// A gitleaks of another version on PATH, which the hook passes over for the image.
	...(dockerRuns()
		? [{ name: "the Docker image", stubs: { pnpm, gitleaks: "#!/bin/sh\necho 8.30.1\n" } }]
		: []),
];

/** The environment of every git command: none of the caller's git variables or configuration, a fixed author. */
function environment(bin: string): NodeJS.ProcessEnv {
	const kept = Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_"));
	return {
		...Object.fromEntries(kept),
		PATH: `${bin}:${process.env.PATH ?? ""}`,
		GIT_CONFIG_GLOBAL: "/dev/null",
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_AUTHOR_NAME: "Test",
		GIT_AUTHOR_EMAIL: "test@example.invalid",
		GIT_COMMITTER_NAME: "Test",
		GIT_COMMITTER_EMAIL: "test@example.invalid",
	};
}

describe("the secret scan of the pre-commit hook", () => {
	it("has gitleaks at the pinned version or Docker to scan with", () => {
		expect(routes.map(({ name }) => name)).not.toEqual([]);
	});

	// Through Docker, the first run downloads the image.
	beforeAll(() => {
		if (routes.length > 0) findGitleaks();
	}, 180_000);

	describe.each(routes)("through $name", ({ stubs }) => {
		let base: string;
		let env: NodeJS.ProcessEnv;
		let main: string;
		let worktree: string;

		function git(cwd: string, ...args: string[]): string {
			return execFileSync("git", args, { cwd, env, encoding: "utf8" });
		}

		/** Commits what is staged in the checkout, through the hook, and returns its exit status and output. */
		function commit(cwd: string): { status: number | null; output: string } {
			const { status, stdout, stderr } = spawnSync("git", ["commit", "-m", "change"], {
				cwd,
				env,
				encoding: "utf8",
			});
			return { status, output: `${stdout}${stderr}` };
		}

		/** Writes a file of the checkout and stages it. */
		function stage(cwd: string, file: string, text: string): void {
			writeFileSync(join(cwd, file), `${text}\n`);
			git(cwd, "add", file);
		}

		beforeEach(() => {
			base = mkdtempSync(join(tmpdir(), "domus-pre-commit-"));
			const bin = join(base, "bin");
			mkdirSync(bin);
			for (const [name, script] of Object.entries(stubs)) {
				writeFileSync(join(bin, name), script);
				chmodSync(join(bin, name), 0o755);
			}
			env = environment(bin);
			main = join(base, "main");
			mkdirSync(main);
			git(main, "init", "--quiet", "--initial-branch", "main");
			copyFileSync(join(root, ".gitleaks.toml"), join(main, ".gitleaks.toml"));
			git(main, "add", ".gitleaks.toml");
			// The first commit, before the hook is on.
			git(main, "commit", "--quiet", "-m", "start");
			git(main, "config", "core.hooksPath", join(root, ".githooks"));
			worktree = join(base, "worktree");
			git(main, "worktree", "add", "--quiet", "-b", "work", worktree);
		});

		afterEach(() => {
			rmSync(base, { recursive: true, force: true });
		});

		describe.each([
			{ checkout: "the main checkout", at: () => main },
			{ checkout: "a git worktree", at: () => worktree },
		])("from $checkout", ({ at }) => {
			it("commits a change without secrets, after scanning it", { timeout: 60_000 }, () => {
				stage(at(), "notes.txt", "nothing secret");
				const { status, output } = commit(at());
				expect(output).toContain("1 commits scanned");
				expect(output).toContain("no leaks found");
				expect(status).toBe(0);
			});

			it(
				"blocks a commit that stages a secret, without printing it",
				{ timeout: 60_000 },
				() => {
					const key = sampleKey();
					stage(at(), "env.txt", `DOMUS_KIRA_KEY="${key}"`);
					const { status, output } = commit(at());
					expect(output).toContain("domus-api-key");
					expect(output).not.toContain(key);
					expect(status).not.toBe(0);
					expect(git(at(), "log", "--format=%s")).toBe("start\n");
				},
			);

			it("scans only what is staged", { timeout: 60_000 }, () => {
				writeFileSync(join(at(), "env.txt"), `DOMUS_KIRA_KEY="${sampleKey()}"\n`);
				stage(at(), "notes.txt", "nothing secret");
				const { status, output } = commit(at());
				expect(output).toContain("no leaks found");
				expect(status).toBe(0);
			});
		});
	});
});

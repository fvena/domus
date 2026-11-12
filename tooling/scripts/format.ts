// Formats a generated file the way `pnpm format` would.
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";

const root = join(import.meta.dirname, "../..");
const oxfmt = join(createRequire(import.meta.url).resolve("oxfmt/package.json"), "../bin/oxfmt");

/**
 * `source` formatted by the Oxfmt CLI with the repository's config, as if it lived at `target`. The CLI, not
 * oxfmt's JS `format()`, which does not apply the CLI defaults.
 */
export function formatWithOxfmt(source: string, target: string): string {
	return execFileSync(process.execPath, [oxfmt, `--stdin-filepath=${target}`], {
		cwd: root,
		input: source,
		encoding: "utf8",
	});
}

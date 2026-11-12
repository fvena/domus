// Runs `drizzle-kit generate` for one schema, for `pnpm db:generate` and the tests that generate a migration.
import { spawnSync } from "node:child_process";
import { join, relative, resolve } from "node:path";

const root = join(import.meta.dirname, "../..");
// drizzle-kit exports neither its bin nor its package.json; pnpm links it next to this script.
const drizzleKit = join(import.meta.dirname, "node_modules/drizzle-kit/bin.cjs");

/**
 * Writes into `out` the migration that takes it to `schema`, if any. drizzle-kit prints its own errors and
 * still exits with 0, so a question it could not ask without a terminal would pass unseen: an error in its
 * output fails here. drizzle-kit may ask about a rename: run it locally, answer, and review what it wrote.
 */
export function drizzleKitGenerate(schema: string, out: string): void {
	const run = spawnSync(
		process.execPath,
		// Both relative to the root: drizzle-kit reads `--out` as relative even when it is absolute.
		[
			drizzleKit,
			"generate",
			"--dialect=sqlite",
			`--schema=${relative(root, resolve(root, schema))}`,
			`--out=${relative(root, resolve(root, out))}`,
		],
		// Its questions go to stdout, so only stderr is read; the answers come from the terminal.
		{ cwd: root, stdio: ["inherit", "inherit", "pipe"], encoding: "utf8" },
	);
	process.stderr.write(run.stderr ?? "");
	if (run.error) throw run.error;
	if (run.status !== 0 || /^\s*\w*Error\b/m.test(run.stderr ?? ""))
		throw new Error(`drizzle-kit generate failed for ${schema}`);
}

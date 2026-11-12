// `pnpm db:generate` (ADR 0021): for every module with a `server/schema.ts`, drizzle-kit writes its new
// migration into `server/migrations/`, and then `server/migrations.ts` is written from that folder.
// drizzle-kit may ask about a rename: run it locally, answer, and review what it wrote. CI runs it with
// stdin closed, so a question there fails the job.
import { spawnSync } from "node:child_process";
import { join } from "node:path";

import { errorMessage, moduleFolders, writeIfChanged } from "./generated";
import { migrationsSource } from "./module-migrations";

const root = join(import.meta.dirname, "../..");
// drizzle-kit exports neither its bin nor its package.json; pnpm links it next to this script.
const drizzleKit = join(import.meta.dirname, "node_modules/drizzle-kit/bin.cjs");

/**
 * Runs `drizzle-kit generate` for one module. drizzle-kit prints its own errors and still exits with 0, so
 * a question it could not ask without a terminal would pass unseen: an error in its output fails here.
 */
function drizzleKitGenerate(server: string): void {
	const run = spawnSync(
		process.execPath,
		[
			drizzleKit,
			"generate",
			"--dialect=sqlite",
			`--schema=${server}/schema.ts`,
			`--out=${server}/migrations`,
		],
		// Its questions go to stdout, so only stderr is read; the answers come from the terminal.
		{ cwd: root, stdio: ["inherit", "inherit", "pipe"], encoding: "utf8" },
	);
	process.stderr.write(run.stderr ?? "");
	if (run.error) throw run.error;
	if (run.status !== 0 || /^\s*\w*Error\b/m.test(run.stderr ?? ""))
		throw new Error(`drizzle-kit generate failed for ${server}`);
}

function generate(): void {
	const modules = moduleFolders(root, "server/schema.ts");
	if (modules.length === 0) console.log("db:generate: no module has a server/schema.ts");

	for (const id of modules) {
		const server = `modules/${id}/server`;
		try {
			drizzleKitGenerate(server);
			const source = migrationsSource(join(root, server, "migrations"));
			if (writeIfChanged(join(root, server, "migrations.ts"), source))
				console.log(`db:generate: wrote ${server}/migrations.ts`);
		} catch (error) {
			throw new Error(`db:generate: module "${id}": ${errorMessage(error)}`);
		}
	}
}

try {
	generate();
} catch (error) {
	console.error(errorMessage(error));
	process.exitCode = 1;
}

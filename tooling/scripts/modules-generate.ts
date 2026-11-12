// `pnpm modules:generate` (ADR 0021): writes the module list of each program from the modules in `modules/`,
// leaving out the testOnly ones. CI regenerates it and fails if anything changed.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { loadModules, moduleListOutputs, moduleListSource } from "./module-list";

const root = join(import.meta.dirname, "../..");

async function generate(): Promise<void> {
	const modules = await loadModules(root);
	for (const output of moduleListOutputs) {
		const source = moduleListSource(modules, output);
		const target = join(root, output.file);
		if (!existsSync(target) || readFileSync(target, "utf8") !== source) {
			writeFileSync(target, source);
			console.log(`modules:generate: wrote ${output.file}`);
		}
	}
}

generate().catch((error: unknown) => {
	console.error(`modules:generate: ${error instanceof Error ? error.message : String(error)}`);
	process.exitCode = 1;
});

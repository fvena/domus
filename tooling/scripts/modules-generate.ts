// `pnpm modules:generate` (ADR 0021): writes the module list of each program from the modules in `modules/`,
// leaving out the testOnly ones. CI regenerates it and fails if anything changed.
import { join } from "node:path";

import { errorMessage, writeIfChanged } from "./generated";
import { loadModules, moduleListOutputs, moduleListSource } from "./module-list";

const root = join(import.meta.dirname, "../..");

async function generate(): Promise<void> {
	const modules = await loadModules(root);
	for (const output of moduleListOutputs) {
		if (writeIfChanged(join(root, output.file), moduleListSource(modules, output)))
			console.log(`modules:generate: wrote ${output.file}`);
	}
}

generate().catch((error: unknown) => {
	console.error(`modules:generate: ${errorMessage(error)}`);
	process.exitCode = 1;
});

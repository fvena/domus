// `pnpm modules:generate` (ADR 0021): writes the module list of apps/api from the modules in `modules/`,
// leaving out the testOnly ones. CI regenerates it and fails if anything changed.
import { join } from "node:path";

import { errorMessage, writeIfChanged } from "./generated";
import { API_MODULE_LIST, loadModules, moduleListSource } from "./module-list";

const root = join(import.meta.dirname, "../..");

async function generate(): Promise<void> {
	const source = moduleListSource(await loadModules(root));
	if (writeIfChanged(join(root, API_MODULE_LIST), source))
		console.log(`modules:generate: wrote ${API_MODULE_LIST}`);
}

generate().catch((error: unknown) => {
	console.error(`modules:generate: ${errorMessage(error)}`);
	process.exitCode = 1;
});

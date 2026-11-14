// `pnpm modules:generate` (ADR 0021): writes the module list of apps/api from the modules in `modules/`,
// leaving out the testOnly ones. CI regenerates it and fails if anything changed. With `--rehearsal`, only the
// build of the rehearsal image runs it: the list has the testOnly ones too.
import { join } from "node:path";

import { errorMessage, writeIfChanged } from "./generated";
import { API_MODULE_LIST, type Composition, loadModules, moduleListSource } from "./module-list";

const root = join(import.meta.dirname, "../..");

/** The composition the arguments ask for: none, or only `--rehearsal`. */
function compositionOf(args: readonly string[]): Composition {
	if (args.length === 0) return "production";
	if (args.length === 1 && args[0] === "--rehearsal") return "rehearsal";
	throw new Error(`unknown arguments: ${args.join(" ")}; the only one is --rehearsal`);
}

async function generate(): Promise<void> {
	const source = moduleListSource(await loadModules(root), compositionOf(process.argv.slice(2)));
	if (writeIfChanged(join(root, API_MODULE_LIST), source))
		console.log(`modules:generate: wrote ${API_MODULE_LIST}`);
}

generate().catch((error: unknown) => {
	console.error(`modules:generate: ${errorMessage(error)}`);
	process.exitCode = 1;
});

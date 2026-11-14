// The fixed module list of apps/api (ADR 0021), written by `pnpm modules:generate` and kept in git. It imports
// the server entry of every module that is not testOnly, in the order of their ids. The rehearsal image alone
// writes over it, in its build, a list with the testOnly ones too. The web gets its own list with its first module
// screen.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { checkModules, type ModuleDefinition } from "@domus/module-sdk";

import { formatWithOxfmt } from "./format";
import { moduleFolders } from "./generated";

/** Where the list is written, from the repository root; never inside a `generated/` folder, which dependency-cruiser skips. */
export const API_MODULE_LIST = "apps/api/src/modules.ts";

/** A module found in `modules/`: its folder, its package and the definition its server entry exports. */
export interface FoundModule {
	readonly folder: string;
	readonly packageName: string;
	readonly definition: ModuleDefinition;
}

/** Every folder of `modules/` with a `server/index.ts`, testOnly ones included, by folder name. */
export async function loadModules(root: string): Promise<FoundModule[]> {
	return Promise.all(
		moduleFolders(root, "server/index.ts").map(async (folder) => {
			const base = join(root, "modules", folder);
			const { name } = JSON.parse(readFileSync(join(base, "package.json"), "utf8")) as {
				name?: string;
			};
			if (!name) throw new Error(`modules/${folder}: package.json has no name`);
			const entry = (await import(pathToFileURL(join(base, "server/index.ts")).href)) as {
				default?: ModuleDefinition;
			};
			if (typeof entry.default?.id !== "string")
				throw new Error(
					`modules/${folder}: server/index.ts must export its defineModule(...) as default`,
				);
			return { folder, packageName: name, definition: entry.default };
		}),
	);
}

/** Which modules a list holds: production's leaves out the testOnly ones, the rehearsal image's has every one. */
export type Composition = "production" | "rehearsal";

const HEADERS: Readonly<Record<Composition, string>> = {
	production:
		"// Written by `pnpm modules:generate` (ADR 0021). Do not edit: add or change a module and generate.",
	rehearsal:
		"// Written by `pnpm modules:generate --rehearsal` (ADR 0021) for the rehearsal image only; never committed.",
};

/**
 * The source of the module list of apps/api, formatted with Oxfmt. Throws when a module's id is not its
 * folder's name, or when the modules would not pass `checkModules`.
 */
export function moduleListSource(
	modules: readonly FoundModule[],
	composition: Composition = "production",
): string {
	for (const { folder, definition } of modules)
		if (definition.id !== folder)
			throw new Error(
				`modules/${folder}: the id is "${definition.id}"; it must be the folder's name, "${folder}"`,
			);
	checkModules(modules.map((module) => module.definition));

	const listed = modules
		.filter((module) => composition === "rehearsal" || !module.definition.testOnly)
		.sort((a, b) => (a.definition.id < b.definition.id ? -1 : 1));
	const name = (module: FoundModule) => `${module.definition.id}Module`;
	const source = [
		HEADERS[composition],
		"",
		'import type { PlatformOptions } from "@domus/platform";',
		...listed.map((module) => `import ${name(module)} from "${module.packageName}/server";`),
		"",
		`export const modules: PlatformOptions["modules"] = [${listed.map(name).join(", ")}];`,
		"",
	].join("\n");
	return formatWithOxfmt(source, API_MODULE_LIST);
}

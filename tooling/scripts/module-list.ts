// The fixed module lists of the programs (ADR 0021), written by `pnpm modules:generate` and kept in git. Each
// list imports one entry of every module that is not testOnly, in the order of their ids. Only apps/api has
// one today; the web's becomes a second `ModuleListOutput` with its first module screen.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { checkModules, type ModuleDefinition } from "@domus/module-sdk";

import { formatWithOxfmt } from "./format";

/** One list a program imports. */
export interface ModuleListOutput {
	/** Where it is written, from the repository root; never inside a `generated/` folder, which dependency-cruiser skips. */
	readonly file: string;
	/** The entry of each module it imports: `<package>/<entry>`. */
	readonly entry: string;
	/** The import of the list's type, and the type itself. */
	readonly typeImport: string;
	readonly type: string;
}

export const apiModuleList: ModuleListOutput = {
	file: "apps/api/src/modules.ts",
	entry: "server",
	typeImport: 'import type { PlatformOptions } from "@domus/platform";',
	type: 'PlatformOptions["modules"]',
};

export const moduleListOutputs: readonly ModuleListOutput[] = [apiModuleList];

/** A module found in `modules/`: its folder, its package and the definition its server entry exports. */
export interface FoundModule {
	readonly folder: string;
	readonly packageName: string;
	readonly definition: ModuleDefinition;
}

/** Every folder of `modules/` with a `server/index.ts`, testOnly ones included, by folder name. */
export async function loadModules(root: string): Promise<FoundModule[]> {
	const folders = readdirSync(join(root, "modules"), { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.filter((folder) => existsSync(join(root, "modules", folder, "server/index.ts")))
		.sort();
	return Promise.all(
		folders.map(async (folder) => {
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

/**
 * The source of one module list, formatted with Oxfmt. Throws when a module's id is not its folder's name,
 * or when the modules would not pass `checkModules`.
 */
export function moduleListSource(
	modules: readonly FoundModule[],
	output: ModuleListOutput,
): string {
	for (const { folder, definition } of modules)
		if (definition.id !== folder)
			throw new Error(
				`modules/${folder}: the id is "${definition.id}"; it must be the folder's name, "${folder}"`,
			);
	checkModules(modules.map((module) => module.definition));

	const listed = modules
		.filter((module) => !module.definition.testOnly)
		.sort((a, b) => (a.definition.id < b.definition.id ? -1 : 1));
	const name = (module: FoundModule) => `${module.definition.id}Module`;
	const source = [
		"// Written by `pnpm modules:generate` (ADR 0021). Do not edit: add or change a module and generate.",
		"",
		output.typeImport,
		...listed.map(
			(module) => `import ${name(module)} from "${module.packageName}/${output.entry}";`,
		),
		"",
		`export const modules: ${output.type} = [${listed.map(name).join(", ")}];`,
		"",
	].join("\n");
	return formatWithOxfmt(source, output.file);
}

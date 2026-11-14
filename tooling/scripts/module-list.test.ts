// The module list generator (ADR 0021): a worked example with definitions written here, and the real
// modules of `modules/`, whose list must match the committed file.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { defineModule } from "@domus/module-sdk";
import { describe, expect, it } from "vitest";

import { API_MODULE_LIST, type FoundModule, loadModules, moduleListSource } from "./module-list";

const root = join(import.meta.dirname, "../..");

function found(folder: string, id: string, testOnly?: boolean): FoundModule {
	return {
		folder,
		packageName: `@domus/${folder}`,
		definition: defineModule({ id, testOnly, schema: {}, migrations: [] }),
	};
}

describe("moduleListSource", () => {
	it("imports each module's server entry, by id, and leaves out the testOnly ones", () => {
		const source = moduleListSource([
			found("tasks", "tasks"),
			found("probe", "probe", true),
			found("lists", "lists"),
		]);
		expect(source).toBe(
			[
				"// Written by `pnpm modules:generate` (ADR 0021). Do not edit: add or change a module and generate.",
				"",
				'import listsModule from "@domus/lists/server";',
				'import type { PlatformOptions } from "@domus/platform";',
				'import tasksModule from "@domus/tasks/server";',
				"",
				'export const modules: PlatformOptions["modules"] = [listsModule, tasksModule];',
				"",
			].join("\n"),
		);
	});

	it("in the rehearsal composition, imports the testOnly ones too", () => {
		const source = moduleListSource(
			[found("tasks", "tasks"), found("probe", "probe", true)],
			"rehearsal",
		);
		expect(source).toBe(
			[
				"// Written by `pnpm modules:generate --rehearsal` (ADR 0021) for the rehearsal image only; never committed.",
				"",
				'import type { PlatformOptions } from "@domus/platform";',
				'import probeModule from "@domus/probe/server";',
				'import tasksModule from "@domus/tasks/server";',
				"",
				'export const modules: PlatformOptions["modules"] = [probeModule, tasksModule];',
				"",
			].join("\n"),
		);
	});

	it("writes an empty list when every module is testOnly", () => {
		expect(moduleListSource([found("probe", "probe", true)])).toBe(
			[
				"// Written by `pnpm modules:generate` (ADR 0021). Do not edit: add or change a module and generate.",
				"",
				'import type { PlatformOptions } from "@domus/platform";',
				"",
				'export const modules: PlatformOptions["modules"] = [];',
				"",
			].join("\n"),
		);
	});

	it("fails when a module's id is not its folder's name", () => {
		expect(() => moduleListSource([found("lists", "shopping")])).toThrow(
			'modules/lists: the id is "shopping"; it must be the folder\'s name, "lists"',
		);
	});

	it("checks the modules as createPlatform does, testOnly ones included", () => {
		expect(() => moduleListSource([found("platform", "platform", true)])).toThrow(
			'module "platform": the id is reserved',
		);
	});
});

describe("the real modules", () => {
	it("give the committed list of apps/api, regenerated in memory", async () => {
		const source = moduleListSource(await loadModules(root));
		expect(source).toBe(readFileSync(join(root, API_MODULE_LIST), "utf8"));
	});

	it("include probe, and its list does not import it", async () => {
		const modules = await loadModules(root);
		expect(modules.map((module) => module.definition.id)).toContain("probe");
		expect(moduleListSource(modules)).not.toContain("@domus/probe");
	});

	it("give the rehearsal image a list that imports probe", async () => {
		expect(moduleListSource(await loadModules(root), "rehearsal")).toContain(
			'import probeModule from "@domus/probe/server";',
		);
	});
});

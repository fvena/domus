import { describe, expect, it } from "vitest";

import { moduleTables, text } from "./db";
import { checkModules, defineModule } from "./index";

function moduleWithId(id: string) {
	return defineModule({ id, schema: {}, migrations: [] });
}

describe("checkModules", () => {
	it.each(["Probe", "probe_notes", "pro-be", "1probe", ""])("rejects the id %j", (id) => {
		expect(() => checkModules([moduleWithId(id)])).toThrow(
			`module "${id}": the id must match [a-z][a-z0-9]*`,
		);
	});

	it("rejects the reserved id platform", () => {
		expect(() => checkModules([moduleWithId("platform")])).toThrow(
			'module "platform": the id is reserved for the platform\'s own tables',
		);
	});

	it("rejects two modules with the same id", () => {
		const modules = [moduleWithId("probe"), moduleWithId("lists"), moduleWithId("probe")];

		expect(() => checkModules(modules)).toThrow('module "probe": two modules have this id');
	});

	it.each(["lists", "probex"])("rejects a table made with the prefix of %j", (otherId) => {
		const { table } = moduleTables(otherId);
		const probe = defineModule({
			id: "probe",
			schema: { notes: table("notes", { body: text() }) },
			migrations: [],
		});

		expect(() => checkModules([probe])).toThrow(
			`module "probe": table "${otherId}_notes" must start with "probe_"`,
		);
	});

	it("accepts modules whose tables carry their own prefix, beside other exports", () => {
		const probe = defineModule({
			id: "probe",
			testOnly: true,
			schema: { notes: moduleTables("probe").table("notes", { body: text() }), limit: 10 },
			migrations: [{ tag: "0000_initial", position: 0, hash: "abc", statements: [] }],
		});
		const lists = defineModule({
			id: "lists",
			schema: { items: moduleTables("lists").table("items", { name: text() }) },
			migrations: [],
		});

		expect(() => checkModules([probe, lists])).not.toThrow();
	});
});

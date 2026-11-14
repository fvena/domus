import { oc } from "@orpc/contract";
import { describe, expect, it } from "vitest";

import { type ActionContract, type ActionMeta, readAction, writeAction } from "./contracts";
import { areaTableOf, moduleTables, primaryKey, text } from "./db";
import { type AreaDefinition, checkModules, defineModule } from "./index";

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

describe("checkModules on areas and permissions", () => {
	/** A module `notes` with one action of the given contract, and the areas given. */
	function notesWith(contract: ActionContract, areas?: Record<string, AreaDefinition>) {
		return defineModule({
			id: "notes",
			areas,
			schema: {},
			migrations: [],
			contract: { act: contract },
			actions: { act: () => undefined as never },
		});
	}

	it("accepts actions in the module's own area, one it declares, another module's and the platform's", () => {
		const lists = defineModule({
			id: "lists",
			areas: { "lists.shared": {} },
			schema: {},
			migrations: [],
		});

		for (const area of [
			undefined,
			"notes",
			"notes.health",
			"lists",
			"lists.shared",
			"platform",
		]) {
			const module = notesWith(readAction({ area, level: "read" }), {
				"notes.health": { alwaysPrivate: true },
			});
			expect(() => checkModules([module, lists]), String(area)).not.toThrow();
		}
		expect(() =>
			checkModules([notesWith(writeAction({ undoable: false, level: "manage" }))]),
		).not.toThrow();
	});

	it("rejects an action in an area that is not registered", () => {
		expect(() =>
			checkModules([notesWith(readAction({ area: "notes.health", level: "read" }))]),
		).toThrow(
			'module "notes": action "notes.act" asks for area "notes.health", which is not registered',
		);
		expect(() =>
			checkModules([notesWith(readAction({ area: "garden", level: "read" }))]),
		).toThrow(/area "garden", which is not registered/);
	});

	it("rejects a write that asks only for read", () => {
		// @ts-expect-error: the type of a write's permission already leaves read out.
		const contract = writeAction({ undoable: false, level: "read" });

		expect(() => checkModules([notesWith(contract)])).toThrow(
			'module "notes": action "notes.act" is a write and cannot ask only for read',
		);
	});

	it("rejects an action that declares no permission, or an unknown level", () => {
		const bare = oc.$meta<ActionMeta>({ kind: "read" } as ActionMeta);
		// @ts-expect-error: readAction asks for its permission.
		const missing = readAction({});
		// @ts-expect-error: only read, write and manage exist.
		const unknown = readAction({ level: "admin" });

		for (const contract of [bare, missing, unknown])
			expect(() => checkModules([notesWith(contract)])).toThrow(
				'module "notes": action "notes.act" declares no permission',
			);
	});

	it.each(["lists", "notes.", "notes.Health", "notes.a.b", "notesx.health"])(
		"rejects the area %j declared by notes",
		(area) => {
			expect(() =>
				checkModules([notesWith(readAction({ level: "read" }), { [area]: {} })]),
			).toThrow(`module "notes": area "${area}" must be "notes" or "notes.<name>"`);
		},
	);

	it("rejects an always private area that is public by default", () => {
		const module = defineModule({
			id: "notes",
			areas: { "notes.health": { alwaysPrivate: true, defaultVisibility: "public" } },
			schema: {},
			migrations: [],
		});

		expect(() => checkModules([module])).toThrow(
			'module "notes": area "notes.health" is always private and cannot be public by default',
		);
	});
});

describe("checkModules on owned tables", () => {
	const areas = {
		notes: {},
		"notes.health": { alwaysPrivate: true },
	} satisfies Record<string, AreaDefinition>;
	const { ownedTable } = moduleTables("notes", areas);

	function notesWithTables(
		schema: Record<string, unknown>,
		declared: Record<string, AreaDefinition> = areas,
	) {
		return defineModule({ id: "notes", areas: declared, schema, migrations: [] });
	}

	it("accepts owned tables in the module's own area and in one it declares", () => {
		const schema = {
			items: ownedTable("items", { type: "item", area: "notes" }, { body: text() }),
			health: ownedTable(
				"health",
				{ type: "health", area: "notes.health" },
				{ body: text() },
			),
		};

		expect(() => checkModules([notesWithTables(schema)])).not.toThrow();
	});

	it("rejects an owned table with a composite key", () => {
		const items = ownedTable(
			"items",
			{ type: "item", area: "notes" },
			{ body: text().notNull() },
			(self) => [primaryKey({ columns: [self.id, self.body] })],
		);

		expect(() => checkModules([notesWithTables({ items })])).toThrow(
			'module "notes": owned table "notes_items" must have the integer "id" as its only key',
		);
	});

	it("rejects an owned table whose area the module does not declare", () => {
		const items = moduleTables("notes", { "notes.garden": {} }).ownedTable(
			"items",
			{ type: "item", area: "notes.garden" },
			{ body: text() },
		);

		expect(() => checkModules([notesWithTables({ items })])).toThrow(
			'module "notes": owned table "notes_items" is in area "notes.garden", which the module does not declare',
		);
	});

	it("rejects an owned table built for another policy than its module declares", () => {
		const health = ownedTable("health", { type: "health", area: "notes.health" }, {});

		expect(() =>
			checkModules([notesWithTables({ health }, { notes: {}, "notes.health": {} })]),
		).toThrow(
			'module "notes": owned table "notes_health" was built for area "notes.health" always private, but the module declares it otherwise',
		);
	});

	it("rejects two owned tables with the same record type", () => {
		const schema = {
			items: ownedTable("items", { type: "item", area: "notes" }, {}),
			others: ownedTable("others", { type: "item", area: "notes" }, {}),
		};

		expect(() => checkModules([notesWithTables(schema)])).toThrow(
			'module "notes": two tables have the record type "item"',
		);
	});
});

describe("checkModules on area tables", () => {
	const areas = {
		notes: {},
		"notes.shared": {},
		"notes.health": { alwaysPrivate: true },
	} satisfies Record<string, AreaDefinition>;
	const { areaTable, ownedTable } = moduleTables("notes", areas);

	function notesWithTables(schema: Record<string, unknown>) {
		return defineModule({ id: "notes", areas, schema, migrations: [] });
	}

	it("declares its record type and area, with the integer id as its only key", () => {
		const labels = areaTable(
			"labels",
			{ type: "label", area: "notes.shared" },
			{ name: text() },
		);

		expect(areaTableOf(labels)).toEqual({ type: "label", area: "notes.shared" });
		expect(Object.keys(labels)).toEqual(expect.arrayContaining(["id", "name"]));
		expect(areaTableOf(moduleTables("notes").table("plain", { name: text() }))).toBeUndefined();
		expect(() => checkModules([notesWithTables({ labels })])).not.toThrow();
	});

	it("rejects an area table that names its own id", () => {
		expect(() =>
			areaTable("labels", { type: "label", area: "notes" }, { id: text() } as never),
		).toThrow('area table "notes_labels": "id" is a column every area table already has');
	});

	it("rejects an area table with a composite key", () => {
		const labels = areaTable(
			"labels",
			{ type: "label", area: "notes" },
			{ name: text().notNull() },
			(self) => [primaryKey({ columns: [self.id, self.name] })],
		);

		expect(() => checkModules([notesWithTables({ labels })])).toThrow(
			'module "notes": area table "notes_labels" must have the integer "id" as its only key',
		);
	});

	it("rejects an area table whose area the module does not declare", () => {
		const labels = moduleTables("notes", { "notes.garden": {} }).areaTable(
			"labels",
			{ type: "label", area: "notes.garden" },
			{},
		);

		expect(() => checkModules([notesWithTables({ labels })])).toThrow(
			'module "notes": area table "notes_labels" is in area "notes.garden", which the module does not declare',
		);
	});

	it("rejects an area table in an always private area, whose records have no owner to be private to", () => {
		const labels = areaTable("labels", { type: "label", area: "notes.health" }, {});

		expect(() => checkModules([notesWithTables({ labels })])).toThrow(
			'module "notes": area table "notes_labels" is in area "notes.health", which is always private',
		);
	});

	it("rejects an area table and an owned table with the same record type", () => {
		const schema = {
			items: ownedTable("items", { type: "item", area: "notes" }, {}),
			labels: areaTable("labels", { type: "item", area: "notes.shared" }, {}),
		};

		expect(() => checkModules([notesWithTables(schema)])).toThrow(
			'module "notes": two tables have the record type "item"',
		);
	});

	it("rejects two area tables with the same record type", () => {
		const schema = {
			labels: areaTable("labels", { type: "label", area: "notes" }, {}),
			tags: areaTable("tags", { type: "label", area: "notes.shared" }, {}),
		};

		expect(() => checkModules([notesWithTables(schema)])).toThrow(
			'module "notes": two tables have the record type "label"',
		);
	});
});

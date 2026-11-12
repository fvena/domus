import { moduleTables, text } from "@domus/module-sdk/db";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import type { AccessView, AreaPolicy, Grant } from ".";
import { checkTransition, editableTo, type RecordArea } from "./writes";

const { ownedTable } = moduleTables("jot");
const jots = ownedTable("items", { type: "jot", area: "jot" }, { body: text().notNull() });

/** Ana's and Luis's records, one private and one public each. */
const ROWS = [
	{ id: 1, owner: "ana", visibility: "private", body: "ana privada" },
	{ id: 2, owner: "ana", visibility: "public", body: "ana pública" },
	{ id: 3, owner: "luis", visibility: "private", body: "luis privada" },
	{ id: 4, owner: "luis", visibility: "public", body: "luis pública" },
] as const;

let connection: Database.Database | undefined;

afterEach(() => {
	connection?.close();
	connection = undefined;
});

function database() {
	connection = new Database(":memory:");
	connection.exec(
		"CREATE TABLE jot_items (id integer PRIMARY KEY, body text NOT NULL, owner text NOT NULL, visibility text NOT NULL)",
	);
	const db = drizzle(connection);
	db.insert(jots)
		.values([...ROWS])
		.run();
	return db;
}

function area(publicEditable: boolean): RecordArea {
	const policy: AreaPolicy = {
		defaultVisibility: "private",
		publicEditable,
		alwaysPrivate: false,
		confirmOnSharedDevice: false,
	};
	return { id: "jot", policy };
}

/** Both members, with `grant` stored in the area for every account. */
function viewWith(grant: Grant, policy: AreaPolicy): AccessView {
	return {
		roleOf: (account) => (account === "ana" || account === "luis" ? "member" : undefined),
		storedGrant: () => grant,
		delegated: () => undefined,
		area: (id) => (id === "jot" ? policy : undefined),
	};
}

/** The ids `editableTo` selects for `account`. */
function editableIds(account: string, publicEditable: boolean, grant: Grant): number[] {
	const target = area(publicEditable);
	return database()
		.select({ id: jots.id })
		.from(jots)
		.where(editableTo(jots, account, target, viewWith(grant, target.policy)))
		.orderBy(jots.id)
		.all()
		.map((row) => row.id);
}

describe("editableTo", () => {
	it("selects, for a non-owner with write in a publicEditable area, the own records and others' public ones", () => {
		expect(editableIds("ana", true, "write")).toEqual([1, 2, 4]);
	});

	it("selects only the own records where the area or the grant does not let others' public ones be edited", () => {
		expect(editableIds("ana", false, "write")).toEqual([1, 2]);
		expect(editableIds("ana", true, "read")).toEqual([1, 2]);
	});

	it.each([
		["ana", true, "write"],
		["ana", true, "read"],
		["ana", false, "write"],
		["ana", false, "read"],
		["luis", true, "write"],
		["luis", false, "read"],
	] as const)(
		"agrees with checkTransition on every record for %s, publicEditable %s, grant %s",
		(account, publicEditable, grant) => {
			const target = area(publicEditable);
			const view = viewWith(grant, target.policy);
			const allowed = ROWS.filter(
				(row) =>
					checkTransition(
						{
							operation: "delete",
							oldId: row.id,
							newId: null,
							oldOwner: row.owner,
							newOwner: null,
							oldVisibility: row.visibility,
							newVisibility: null,
						},
						account,
						target,
						view,
					) === "allow",
			).map((row) => row.id);

			expect(editableIds(account, publicEditable, grant)).toEqual(allowed);
		},
	);
});

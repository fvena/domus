import { describe, expect, it } from "vitest";

import {
	type AccessView,
	type AreaPolicy,
	type AuthorizationRequest,
	createAuthorizer,
	decide,
	type Grant,
	isAllowed,
	type PermissionLevel,
	type Role,
	sealContext,
} from ".";

const AREAS: Readonly<Record<string, AreaPolicy>> = {
	notes: { alwaysPrivate: false },
	health: { alwaysPrivate: true },
};

/** A view built in the test: roles by account and stored rows by `<account>/<area>`. */
function viewOf(
	roles: Readonly<Record<string, Role>>,
	rows: Readonly<Record<string, Grant>> = {},
): AccessView {
	return {
		roleOf: (account) => roles[account],
		storedGrant: (account, area) => rows[`${account}/${area}`],
		area: (id) => AREAS[id],
	};
}

function request(account: string, area: string, level: PermissionLevel): AuthorizationRequest {
	return {
		context: sealContext({
			account,
			device: "d1",
			deviceAccount: account,
			channel: "app",
			identity: "password",
		}),
		action: `${area}.something`,
		permission: { area, level },
		input: undefined,
	};
}

const LEVELS: readonly PermissionLevel[] = ["read", "write", "manage"];

/** The levels an account reaches in an area, in order. */
function reached(view: AccessView, account: string, area: string): PermissionLevel[] {
	return LEVELS.filter((level) => decide(request(account, area, level), view) === "allow");
}

describe("decide", () => {
	it("treats levels as cumulative: each one includes those before it", () => {
		const view = viewOf(
			{ none: "member", reader: "member", writer: "member", manager: "member" },
			{
				"none/notes": "none",
				"reader/notes": "read",
				"writer/notes": "write",
				"manager/notes": "manage",
			},
		);

		expect(reached(view, "none", "notes")).toEqual([]);
		expect(reached(view, "reader", "notes")).toEqual(["read"]);
		expect(reached(view, "writer", "notes")).toEqual(["read", "write"]);
		expect(reached(view, "manager", "notes")).toEqual(["read", "write", "manage"]);
	});

	it("gives each role its default: admin manage, member write, device read but nothing where always private", () => {
		const view = viewOf({ paco: "admin", ana: "member", kitchen: "device" });

		expect(reached(view, "paco", "notes")).toEqual(["read", "write", "manage"]);
		expect(reached(view, "paco", "health")).toEqual(["read", "write", "manage"]);
		expect(reached(view, "ana", "notes")).toEqual(["read", "write"]);
		expect(reached(view, "ana", "health")).toEqual(["read", "write"]);
		expect(reached(view, "kitchen", "notes")).toEqual(["read"]);
		expect(reached(view, "kitchen", "health")).toEqual([]);
	});

	it("replaces the default with a stored row, up or down, only in that area", () => {
		const view = viewOf(
			{ ana: "member", kitchen: "device" },
			{ "ana/notes": "read", "kitchen/notes": "write", "kitchen/health": "read" },
		);

		expect(reached(view, "ana", "notes")).toEqual(["read"]);
		expect(reached(view, "ana", "health")).toEqual(["read", "write"]);
		expect(reached(view, "kitchen", "notes")).toEqual(["read", "write"]);
		expect(reached(view, "kitchen", "health")).toEqual(["read"]);
	});

	it("never lowers the admin below manage, whatever row is stored", () => {
		const view = viewOf({ paco: "admin" }, { "paco/notes": "none", "paco/health": "read" });

		expect(reached(view, "paco", "notes")).toEqual(["read", "write", "manage"]);
		expect(reached(view, "paco", "health")).toEqual(["read", "write", "manage"]);
	});

	it("denies an account without a role and an area that is not registered", () => {
		const view = viewOf({ ana: "member" });

		expect(reached(view, "nobody", "notes")).toEqual([]);
		expect(reached(view, "ana", "garden")).toEqual([]);
	});
});

describe("the production authorizer", () => {
	it("denies when reading the view throws", () => {
		const authorizer = createAuthorizer({
			roleOf: () => {
				throw new Error("database gone");
			},
			storedGrant: () => undefined,
			area: (id) => AREAS[id],
		});

		expect(isAllowed(authorizer, request("ana", "notes", "read"))).toBe(false);
	});

	it("allows what decide allows", () => {
		const authorizer = createAuthorizer(viewOf({ ana: "member" }));

		expect(isAllowed(authorizer, request("ana", "notes", "write"))).toBe(true);
		expect(isAllowed(authorizer, request("ana", "notes", "manage"))).toBe(false);
	});
});

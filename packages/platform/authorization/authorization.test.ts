import { describe, expect, it } from "vitest";

import {
	type AccessView,
	type AreaPolicy,
	type AuthorizationRequest,
	createAuthorizer,
	decide,
	type Delegated,
	type Grant,
	isAllowed,
	type PermissionLevel,
	type Role,
	sealContext,
} from ".";

const AREAS: Readonly<Record<string, AreaPolicy>> = {
	notes: policy({}),
	health: policy({ alwaysPrivate: true }),
	vitals: policy({ alwaysPrivate: true, confirmOnSharedDevice: true }),
	shared: policy({ confirmOnSharedDevice: true }),
};

/** An area's policy: the defaults of an area that declares nothing, with `fields` over them. */
function policy(fields: Partial<AreaPolicy>): AreaPolicy {
	return {
		defaultVisibility: "private",
		publicEditable: false,
		alwaysPrivate: false,
		confirmOnSharedDevice: false,
		...fields,
	};
}

/**
 * A view built in the test: roles by account, stored rows by `<account>/<area>` and delegation rows by
 * `<account>/<area>/<level>`.
 */
function viewOf(
	roles: Readonly<Record<string, Role>>,
	rows: Readonly<Record<string, Grant>> = {},
	delegation: Readonly<Record<string, Delegated>> = {},
): AccessView {
	return {
		roleOf: (account) => roles[account],
		storedGrant: (account, area) => rows[`${account}/${area}`],
		delegated: (account, area, level) => delegation[`${account}/${area}/${level}`],
		area: (id) => AREAS[id],
	};
}

function request(
	account: string,
	area: string,
	level: PermissionLevel,
	via?: string,
): AuthorizationRequest {
	return {
		context: sealContext({
			account,
			...(via === undefined ? {} : { via }),
			device: "d1",
			deviceAccount: account,
			channel: "app",
			identity: "password",
		}),
		action: `${area}.something`,
		kind: level === "read" ? "read" : "write",
		permission: { area, level },
		input: undefined,
	};
}

const LEVELS: readonly PermissionLevel[] = ["read", "write", "manage"];

/** The levels an account reaches in an area, in order, by itself or through `via`. */
function reached(view: AccessView, account: string, area: string, via?: string): PermissionLevel[] {
	return LEVELS.filter((level) => decide(request(account, area, level, via), view) === "allow");
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

describe("decide via Kira", () => {
	it("applies each level's delegation alone: reading yes does not carry writing, nor writing yes reading", () => {
		const view = viewOf(
			{ ana: "member" },
			{},
			{
				"ana/notes/read": "yes",
				"ana/notes/write": "no",
				"ana/health/read": "no",
				"ana/health/write": "yes",
			},
		);

		expect(reached(view, "ana", "notes", "kira")).toEqual(["read"]);
		expect(reached(view, "ana", "health", "kira")).toEqual(["write"]);
	});

	it("denies a level whose delegation is no", () => {
		const view = viewOf({ ana: "member" }, {}, { "ana/notes/read": "no" });

		expect(reached(view, "ana", "notes", "kira")).toEqual([]);
	});

	it("asks for confirmation on a level whose delegation is confirm, and allows once it is confirmed", () => {
		const view = viewOf(
			{ ana: "member" },
			{},
			{ "ana/notes/read": "yes", "ana/notes/write": "confirm" },
		);
		const writing = request("ana", "notes", "write", "kira");

		expect(reached(view, "ana", "notes", "kira")).toEqual(["read"]);
		expect(decide(writing, view)).toBe("confirm");
		expect(decide({ ...writing, confirmed: true }, view)).toBe("allow");
	});

	it("still denies on confirm what the permission denies", () => {
		const view = viewOf(
			{ ana: "member" },
			{ "ana/notes": "read" },
			{ "ana/notes/write": "confirm" },
		);

		expect(decide(request("ana", "notes", "write", "kira"), view)).toBe("deny");
		expect(decide({ ...request("ana", "notes", "write", "kira"), confirmed: true }, view)).toBe(
			"deny",
		);
	});

	it("takes an area or a level without a row as no", () => {
		const view = viewOf({ ana: "member" }, {}, { "ana/notes/read": "yes" });

		expect(reached(view, "ana", "notes", "kira")).toEqual(["read"]);
		expect(reached(view, "ana", "health", "kira")).toEqual([]);
	});

	it("never goes past the account's permission, whatever the delegation says", () => {
		const view = viewOf(
			{ ana: "member", kitchen: "device" },
			{ "ana/notes": "read" },
			{
				"ana/notes/read": "yes",
				"ana/notes/write": "yes",
				"ana/notes/manage": "yes",
				"kitchen/health/read": "yes",
			},
		);

		expect(reached(view, "ana", "notes", "kira")).toEqual(["read"]);
		expect(reached(view, "kitchen", "health", "kira")).toEqual([]);
	});

	it("reads the delegation of the represented account, not another's", () => {
		const view = viewOf(
			{ ana: "member", luis: "member" },
			{},
			{ "luis/notes/read": "yes", "luis/notes/write": "yes" },
		);

		expect(reached(view, "ana", "notes", "kira")).toEqual([]);
		expect(reached(view, "luis", "notes", "kira")).toEqual(["read", "write"]);
	});

	it("does not apply the delegation without via", () => {
		const view = viewOf(
			{ ana: "member" },
			{},
			{ "ana/notes/read": "no", "ana/notes/write": "no" },
		);

		expect(reached(view, "ana", "notes")).toEqual(["read", "write"]);
	});
});

describe("decide on an action that always asks for confirmation", () => {
	const always = (account: string, via?: string): AuthorizationRequest => {
		const base = request(account, "notes", "write", via);
		return { ...base, permission: { ...base.permission, alwaysConfirm: true } };
	};

	it("asks once, with or without via, and one confirmation answers it", () => {
		const view = viewOf({ ana: "member" }, {}, { "ana/notes/write": "yes" });

		expect(decide(always("ana"), view)).toBe("confirm");
		expect(decide(always("ana", "kira"), view)).toBe("confirm");
		expect(decide({ ...always("ana"), confirmed: true }, view)).toBe("allow");
	});

	it("asks only once when the delegation says confirm too", () => {
		const view = viewOf({ ana: "member" }, {}, { "ana/notes/write": "confirm" });

		expect(decide(always("ana", "kira"), view)).toBe("confirm");
		expect(decide({ ...always("ana", "kira"), confirmed: true }, view)).toBe("allow");
	});

	it("denies before asking when the delegation says no", () => {
		const view = viewOf({ ana: "member" }, {}, { "ana/notes/write": "no" });

		expect(decide(always("ana", "kira"), view)).toBe("deny");
	});
});

describe("decide on a shared device", () => {
	const view = viewOf({ ana: "member", kitchen: "device" }, { "kitchen/vitals": "read" });
	/** A read on the kitchen screen: by the device account itself, or by a member recognized by voice. */
	const onKitchen = (account: string, area: string, level: PermissionLevel = "read") => {
		const base = request(account, area, level);
		return {
			...base,
			context: sealContext({
				...base.context,
				deviceAccount: "kitchen",
				identity: account === "kitchen" ? "device" : "voice",
			}),
		};
	};

	it("asks a recognized member for confirmation to read a confirmOnSharedDevice area", () => {
		expect(decide(onKitchen("ana", "vitals"), view)).toBe("confirm");
		expect(decide({ ...onKitchen("ana", "vitals"), confirmed: true }, view)).toBe("allow");
	});

	it("denies it without a recognized member, even with a row that grants reading", () => {
		expect(decide(onKitchen("kitchen", "vitals"), view)).toBe("deny");
		expect(decide(onKitchen("kitchen", "shared"), view)).toBe("deny");
		expect(decide({ ...onKitchen("kitchen", "vitals"), confirmed: true }, view)).toBe("deny");
	});

	it("does not apply to an always private area without the rule, nor off a shared device", () => {
		expect(decide(onKitchen("ana", "health"), view)).toBe("allow");
		expect(decide(onKitchen("ana", "notes"), view)).toBe("allow");
		expect(decide(request("ana", "vitals", "read"), view)).toBe("allow");
	});

	it("applies to reading, not to writing", () => {
		expect(decide(onKitchen("ana", "vitals", "write"), view)).toBe("allow");
	});
});

describe("decide on an account's own settings", () => {
	const view = viewOf(
		{ paco: "admin", ana: "member", luis: "member", kitchen: "device" },
		{},
		{ "ana/platform/read": "no" },
	);
	const about = (account: string, subject: string, via?: string) =>
		decide(
			{ ...request(account, "platform", "read", via), subject },
			{ ...view, area: (id) => (id === "platform" ? policy({}) : undefined) },
		);

	it("lets each account reach its own", () => {
		expect(about("ana", "ana")).toBe("allow");
		expect(about("paco", "paco")).toBe("allow");
	});

	it("lets the admin reach the device account's, and nobody else's", () => {
		expect(about("paco", "kitchen")).toBe("allow");
		expect(about("paco", "ana")).toBe("deny");
		expect(about("ana", "luis")).toBe("deny");
		expect(about("ana", "kitchen")).toBe("deny");
		expect(about("ana", "nobody")).toBe("deny");
	});

	it("still applies the permission and, via Kira, the delegation", () => {
		expect(about("ana", "ana", "kira")).toBe("deny");
	});
});

describe("the production authorizer", () => {
	it("denies when reading the view throws", () => {
		const authorizer = createAuthorizer({
			roleOf: () => {
				throw new Error("database gone");
			},
			storedGrant: () => undefined,
			delegated: () => undefined,
			area: (id) => AREAS[id],
		});

		expect(isAllowed(authorizer, request("ana", "notes", "read"))).toBe(false);
	});

	it("allows what decide allows", () => {
		const authorizer = createAuthorizer(viewOf({ ana: "member" }));

		expect(isAllowed(authorizer, request("ana", "notes", "write"))).toBe(true);
		expect(isAllowed(authorizer, request("ana", "notes", "manage"))).toBe(false);
	});

	it("does not take asking for confirmation as allowing", () => {
		const authorizer = createAuthorizer(
			viewOf({ ana: "member" }, {}, { "ana/notes/write": "confirm" }),
		);

		expect(isAllowed(authorizer, request("ana", "notes", "write", "kira"))).toBe(false);
	});
});

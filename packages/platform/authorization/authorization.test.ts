import { describe, expect, it } from "vitest";

import {
	type AccessView,
	type AreaPolicy,
	type AuthorizationRequest,
	createAuthorizer,
	decide,
	decisionOf,
	type Delegated,
	type Grant,
	isAllowed,
	maySubscribe,
	mayUpload,
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
		// A manage level is sensitive: these tests of levels bring the step-up proof it asks for.
		...(level === "manage" ? { proof: "valid" as const } : {}),
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

	it("asks a recognized member to confirm in context only, to read a confirmOnSharedDevice area", () => {
		expect(decide(onKitchen("ana", "vitals"), view)).toBe("confirm-in-context");
		expect(decide({ ...onKitchen("ana", "vitals"), confirmed: true }, view)).toBe("allow");
	});

	it("asks in context only even when the delegation asks to confirm too", () => {
		const delegating = viewOf(
			{ ana: "member", kitchen: "device" },
			{},
			{ "ana/vitals/read": "confirm" },
		);
		const viaKira = { ...onKitchen("ana", "vitals") };
		const request = {
			...viaKira,
			context: sealContext({ ...viaKira.context, via: "kira" }),
		};

		expect(decide(request, delegating)).toBe("confirm-in-context");
		expect(decisionOf(createAuthorizer(delegating), request)).toBe("confirm-in-context");
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

describe("decide on a sensitive operation", () => {
	const view = viewOf(
		{ paco: "admin", ana: "member", luis: "member", kitchen: "device" },
		{},
		{
			"ana/platform/write": "yes",
			"paco/notes/manage": "yes",
		},
	);
	const platformView: AccessView = {
		...view,
		area: (id) => (id === "platform" ? policy({}) : AREAS[id]),
	};
	/** A sensitive operation of the platform: changing access or delegation, or revoking sessions. */
	const operation = (
		account: string,
		sensitive: NonNullable<AuthorizationRequest["sensitive"]>,
		subject: string,
		options: { via?: string; proof?: "valid" | "invalid" } = {},
	): AuthorizationRequest => ({
		...request(account, "platform", "write", options.via),
		sensitive,
		subject,
		...(options.proof === undefined ? {} : { proof: options.proof }),
	});
	const manage = (account: string, proof?: "valid" | "invalid"): AuthorizationRequest => {
		const { proof: _proof, ...base } = request(account, "notes", "manage");
		return proof === undefined ? base : { ...base, proof };
	};
	const proven = (identity: "password" | "voice" | "device") => {
		const base = manage("paco", "valid");
		return { ...base, context: sealContext({ ...base.context, identity }) };
	};

	it("asks for a step-up proof on a manage level, and allows it with a valid one", () => {
		expect(decide(manage("paco"), view)).toBe("step-up");
		expect(decide(manage("paco", "invalid"), view)).toBe("step-up");
		expect(decide(manage("paco", "valid"), view)).toBe("allow");
	});

	it("asks for a proof on changing access, delegation or sessions", () => {
		expect(decide(operation("paco", "permissions", "ana"), platformView)).toBe("step-up");
		expect(decide(operation("ana", "delegation", "ana"), platformView)).toBe("step-up");
		expect(decide(operation("ana", "sessions", "ana"), platformView)).toBe("step-up");
		expect(
			decide(operation("paco", "permissions", "ana", { proof: "valid" }), platformView),
		).toBe("allow");
	});

	it("denies it when the identity was proven by voice or by the device, even with a proof", () => {
		expect(decide(proven("password"), view)).toBe("allow");
		expect(decide(proven("voice"), view)).toBe("deny");
		expect(decide(proven("device"), view)).toBe("deny");
	});

	it("denies changing access or delegation via Kira, even with a proof and the delegation", () => {
		const viaKira = { via: "kira", proof: "valid" } as const;

		expect(decide(operation("ana", "delegation", "ana", viaKira), platformView)).toBe("deny");
		expect(decide(operation("paco", "permissions", "ana", viaKira), platformView)).toBe("deny");
		expect(decide(operation("ana", "sessions", "ana", viaKira), platformView)).toBe("allow");
	});

	it("lets only the admin change permissions, of a member or the device account, never its own", () => {
		const proof = { proof: "valid" } as const;
		const permissions = (account: string, subject: string) =>
			decide(operation(account, "permissions", subject, proof), platformView);

		expect(permissions("paco", "ana")).toBe("allow");
		expect(permissions("paco", "kitchen")).toBe("allow");
		expect(permissions("paco", "paco")).toBe("deny");
		expect(permissions("ana", "ana")).toBe("deny");
		expect(permissions("ana", "luis")).toBe("deny");
		expect(permissions("paco", "nobody")).toBe("deny");
	});

	it("lets each person change their own delegation, and the admin the device account's", () => {
		const proof = { proof: "valid" } as const;
		const delegation = (account: string, subject: string) =>
			decide(operation(account, "delegation", subject, proof), platformView);

		expect(delegation("ana", "ana")).toBe("allow");
		expect(delegation("paco", "kitchen")).toBe("allow");
		expect(delegation("ana", "luis")).toBe("deny");
		expect(delegation("paco", "ana")).toBe("deny");
	});

	it("takes a proof brought to an operation that is not sensitive as not matching", () => {
		expect(decide({ ...request("ana", "notes", "write"), proof: "valid" }, view)).toBe(
			"step-up",
		);
	});

	it("asks for confirmation first, and for the proof once it is confirmed", () => {
		const { proof: _proof, ...asked } = request("paco", "notes", "manage", "kira");
		const always: AuthorizationRequest = {
			...asked,
			permission: { ...asked.permission, alwaysConfirm: true },
		};

		expect(decide(always, view)).toBe("confirm");
		expect(decide({ ...always, proof: "valid" }, view)).toBe("confirm");
		expect(decide({ ...always, confirmed: true }, view)).toBe("step-up");
		expect(decide({ ...always, confirmed: true, proof: "valid" }, view)).toBe("allow");
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

	it("passes asking for a step-up proof through, and does not take it as allowing", () => {
		const authorizer = createAuthorizer(viewOf({ paco: "admin" }));
		const { proof: _proof, ...unproven } = request("paco", "notes", "manage");

		expect(decisionOf(authorizer, unproven)).toBe("step-up");
		expect(isAllowed(authorizer, unproven)).toBe(false);
	});

	it("does not take asking for confirmation as allowing", () => {
		const authorizer = createAuthorizer(
			viewOf({ ana: "member" }, {}, { "ana/notes/write": "confirm" }),
		);

		expect(isAllowed(authorizer, request("ana", "notes", "write", "kira"))).toBe(false);
	});
});

describe("who may upload a file", () => {
	const view = viewOf({ ana: "member", paco: "admin", kitchen: "device" });

	it("is a person by itself, never the device account nor Kira on a person's behalf", () => {
		const uploads = (account: string, via?: string) =>
			mayUpload(view, request(account, "notes", "write", via).context);

		expect([uploads("ana"), uploads("paco"), uploads("kitchen")]).toEqual([true, true, false]);
		expect(uploads("ana", "kira")).toBe(false);
		expect(uploads("nobody")).toBe(false);
	});
});

describe("who may subscribe to notices", () => {
	const view = viewOf({ ana: "member", paco: "admin", kitchen: "device" });

	it("is a person by itself, never the device account, Kira on a person's behalf nor an account without a role", () => {
		const subscribes = (account: string, via?: string) =>
			maySubscribe(view, request(account, "notes", "read", via).context);

		expect([subscribes("ana"), subscribes("paco"), subscribes("kitchen")]).toEqual([
			true,
			true,
			false,
		]);
		expect(subscribes("ana", "kira")).toBe(false);
		expect(subscribes("nobody")).toBe(false);
	});
});

import { defineModule } from "@domus/module-sdk";
import { readAction } from "@domus/module-sdk/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { actionsOf, openPlatform, type Platform } from "../platform";
import { syntheticContext } from "../testing";

const errors = { PROBLEM: { message: "no se puede", data: z.object({ reason: z.string() }) } };

const desk = defineModule({
	id: "desk",
	schema: {},
	migrations: [],
	contract: {
		refuse: readAction({ level: "read" }).errors(errors),
		/** Throws its declared error with data its schema rejects. */
		refuseBadly: readAction({ level: "read" }).errors(errors),
	},
	actions: {
		refuse: ({ errors }) => {
			throw errors.PROBLEM({ data: { reason: "cerrado" } });
		},
		refuseBadly: ({ errors }) => {
			throw errors.PROBLEM({ data: { reason: 1 as unknown as string } });
		},
	},
});

const ana = syntheticContext({
	account: "ana",
	device: "d1",
	deviceAccount: "ana",
	channel: "app",
	identity: "password",
});

let platform: Platform | undefined;
afterEach(() => {
	platform?.close();
	platform = undefined;
});

function thrownBy(action: string): unknown {
	platform = openPlatform(
		{ databaseFile: ":memory:", modules: [desk] },
		{ authorizer: () => "allow", clock: () => Date.UTC(2026, 10, 12) },
	);
	try {
		actionsOf(platform).invoke({ context: ana, action, input: undefined });
	} catch (error) {
		return error;
	}
	throw new Error(`${action} did not throw`);
}

describe("an error its contract declares", () => {
	it("leaves with its code and its typed data", () => {
		const error = thrownBy("desk.refuse");

		expect(error).toMatchObject({ code: "PROBLEM", data: { reason: "cerrado" } });
	});

	it("fails as an internal error when its data does not pass the contract's schema", () => {
		const error = thrownBy("desk.refuseBadly");

		expect(error).toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
		expect(error).not.toHaveProperty("data.reason");
	});
});

describe("the type of a handler's errors", () => {
	it("takes the data each declared error's schema asks for", () => {
		defineModule({
			id: "typed",
			schema: {},
			migrations: [],
			contract: { refuse: readAction({ level: "read" }).errors(errors) },
			actions: {
				refuse: ({ errors }) => {
					// @ts-expect-error: PROBLEM needs its data.
					errors.PROBLEM();
					// @ts-expect-error: its reason is a string.
					errors.PROBLEM({ data: { reason: 1 } });
					throw errors.PROBLEM({ data: { reason: "cerrado" } });
				},
			},
		});
	});
});

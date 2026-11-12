import { describe, expect, it } from "vitest";

import * as platform from ".";

describe("the main entry of platform", () => {
	// A module's raw client lives in @domus/platform/testing, which only test-utils may import (ADR 0021).
	it("does not offer the Drizzle client of a module", () => {
		expect(platform).not.toHaveProperty("moduleDatabase");
	});

	// Production has no switch that lets everything through (ADR 0022, ADR 0023): no other authorizer, no
	// synthetic context and no way to invoke the actions but the door, with a session.
	it("offers only createPlatform and the door", () => {
		expect(Object.keys(platform).sort()).toEqual(["createHttpHandler", "createPlatform"]);
	});
});

import { describe, expect, it } from "vitest";

import * as platform from ".";

describe("the main entry of platform", () => {
	// A module's raw client lives in @domus/platform/testing, which only test-utils may import (ADR 0021).
	it("does not offer the Drizzle client of a module", () => {
		expect(platform).not.toHaveProperty("moduleDatabase");
	});

	// Production has no switch that lets everything through (ADR 0022): another authorizer, and invoking the
	// actions, come only from @domus/platform/testing until the door serves them in phase 1c.
	it("offers only createPlatform and the door", () => {
		expect(Object.keys(platform).sort()).toEqual(["createHttpHandler", "createPlatform"]);
	});
});

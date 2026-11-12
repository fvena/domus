import { describe, expect, it } from "vitest";

import * as platform from ".";

describe("the main entry of platform", () => {
	// A module's raw client lives in @domus/platform/testing, which only test-utils may import (ADR 0021).
	it("does not offer the Drizzle client of a module", () => {
		expect(platform).not.toHaveProperty("moduleDatabase");
	});
});

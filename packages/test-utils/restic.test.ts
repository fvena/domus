import { describe, expect, it } from "vitest";

import { requireRestic } from "./restic";

describe("requireRestic", () => {
	it("passes with the restic the tests use", () => {
		expect(() => requireRestic()).not.toThrow();
	});

	it("fails with what to install when restic is missing", () => {
		expect(() => requireRestic("/nonexistent/restic")).toThrow(
			"restic is required: brew install restic",
		);
	});
});

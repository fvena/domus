import { describe, expect, it } from "vitest";

import { readPort } from ".";

describe("program", () => {
	it("reads the port, or falls back", () => {
		expect(readPort("3100", 3000)).toBe(3100);
		expect(readPort(undefined, 3000)).toBe(3000);
	});

	it("refuses a port that is not a positive integer", () => {
		expect(() => readPort("abc", 3000)).toThrow(/PORT/);
		expect(() => readPort("0", 3000)).toThrow(/PORT/);
	});
});

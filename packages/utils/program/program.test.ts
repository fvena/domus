import { describe, expect, it } from "vitest";

import { createHealthApp, readPort, readUrl } from ".";

describe("program", () => {
	it("reads the port, or falls back", () => {
		expect(readPort("3100", 3000)).toBe(3100);
		expect(readPort(undefined, 3000)).toBe(3000);
	});

	it("refuses a port that is not a positive integer", () => {
		expect(() => readPort("abc", 3000)).toThrow(/PORT/);
		expect(() => readPort("0", 3000)).toThrow(/PORT/);
	});

	it("refuses to start without a required address", () => {
		expect(() => readUrl(undefined, "DOMUS_API_URL", "http://api:3000")).toThrow(
			/DOMUS_API_URL/,
		);
		expect(readUrl("http://api:3000", "DOMUS_API_URL", "").origin).toBe("http://api:3000");
	});

	it("answers the health check", async () => {
		const res = await createHealthApp().request("/health");
		expect(await res.json()).toEqual({ status: "ok" });
	});
});

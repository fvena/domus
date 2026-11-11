import { describe, expect, it } from "vitest";

import { readConfig } from "./config";

describe("readConfig", () => {
	it("refuses to start without the api address", () => {
		expect(() => readConfig({})).toThrow(/DOMUS_API_URL/);
	});
});

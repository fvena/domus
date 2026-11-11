import { describe, expect, it } from "vitest";

import { createApp } from "./app";
import { readConfig } from "./config";

describe("assistant", () => {
	it("answers the health check", async () => {
		const res = await createApp().request("/health");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ status: "ok" });
	});

	it("refuses to start without the api address", () => {
		expect(() => readConfig({})).toThrow(/DOMUS_API_URL/);
	});
});

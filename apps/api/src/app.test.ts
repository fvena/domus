import { describe, expect, it } from "vitest";

import { createApp } from "./app";

describe("api", () => {
	const app = createApp({ webDir: undefined });

	it("passes the health check to the door", async () => {
		const res = await app.request("/health");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ status: "ok" });
	});

	it("passes RPC calls to the door", async () => {
		const res = await app.request("/api/rpc/status", { method: "POST" });
		expect(res.status).toBe(200);
	});
});

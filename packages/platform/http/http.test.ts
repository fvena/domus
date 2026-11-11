import type { AddressInfo } from "node:net";

import { clientFor } from "@domus/api-client";
import { serve } from "@hono/node-server";
import { afterAll, describe, expect, it } from "vitest";

import { createHttpHandler } from ".";
import { PROTOCOL, platformContract } from "../contracts";

describe("http handler", () => {
	const handler = createHttpHandler();

	it("answers the health check", async () => {
		const response = await handler.fetch(new Request("http://domus/health"));
		expect(await response.json()).toEqual({ status: "ok" });
	});

	it("answers status in process", async () => {
		const client = clientFor(platformContract, {
			baseUrl: "http://domus",
			fetch: handler.fetch,
		});
		expect(await client.status()).toEqual({ service: "domus", protocol: PROTOCOL });
	});

	describe("over real HTTP", () => {
		const server = serve({ fetch: handler.fetch, port: 0 });
		afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

		it("answers status", async () => {
			const { port } = server.address() as AddressInfo;
			const client = clientFor(platformContract, { baseUrl: `http://127.0.0.1:${port}` });
			expect(await client.status()).toEqual({ service: "domus", protocol: PROTOCOL });
		});
	});

	it("answers 404 for an unknown procedure", async () => {
		const response = await handler.fetch(
			new Request("http://domus/api/rpc/nothing", { method: "POST" }),
		);
		expect(response.status).toBe(404);
	});
});

import type { AddressInfo } from "node:net";

import { clientFor } from "@domus/api-client";
import { defineModule } from "@domus/module-sdk";
import { readAction } from "@domus/module-sdk/contracts";
import { id, moduleTables } from "@domus/module-sdk/db";
import { serve } from "@hono/node-server";
import { afterAll, describe, expect, it } from "vitest";

import { createHttpHandler } from ".";
import { PROTOCOL, platformContract } from "../contracts";
import { createPlatform } from "../platform";

const { table } = moduleTables("notes");
const notes = defineModule({
	id: "notes",
	schema: { items: table("items", { id: id() }) },
	migrations: [
		{
			tag: "0000_notes",
			position: 0,
			hash: "hash-of-0000_notes",
			statements: [
				"CREATE TABLE `notes_items` (`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL);",
			],
		},
	],
	contract: { list: readAction() },
	actions: { list: () => [] },
});

describe("http handler", () => {
	const modules = [notes];
	const platform = createPlatform({ databaseFile: ":memory:", modules });
	afterAll(() => platform.close());
	const handler = createHttpHandler({ platform, modules });

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

	it("publishes nothing of the modules it receives, their actions included", async () => {
		for (const path of [
			"/api/rpc/notes",
			"/api/rpc/notes/items",
			"/api/rpc/notes/list",
			"/api/rpc/notes.list",
			"/api/notes",
		]) {
			const response = await handler.fetch(
				new Request(`http://domus${path}`, { method: "POST" }),
			);
			expect(response.status, path).toBe(404);
		}
	});
});

import type { AddressInfo } from "node:net";

import { clientFor } from "@domus/api-client";
import { defineModule } from "@domus/module-sdk";
import { readAction, writeAction } from "@domus/module-sdk/contracts";
import { id, moduleTables } from "@domus/module-sdk/db";
import { serve } from "@hono/node-server";
import { afterAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createHttpHandler } from ".";
import { PROTOCOL, platformContract } from "../contracts";
import { actionsOf, connectionOf, createPlatform } from "../platform";
import { prepareAccount, preparePassword } from "../testing";

const { table } = moduleTables("notes");
const notesContract = {
	list: readAction({ level: "read" }).output(z.array(z.number())),
	add: writeAction({ undoable: false, level: "write" }).output(z.number()),
};
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
	contract: notesContract,
	actions: { list: () => [], add: () => ({ result: 1, touched: [] }) },
});

const auth = { secret: "a-secret-only-for-the-tests-of-the-door", origins: ["http://domus"] };

describe("http handler", () => {
	const modules = [notes];
	const platform = createPlatform({ databaseFile: ":memory:", modules });
	afterAll(() => platform.close());
	const handler = createHttpHandler({ platform, modules, auth });

	it("answers the health check", async () => {
		const response = await handler.fetch(new Request("http://domus/health"));
		expect(await response.json()).toEqual({ status: "ok", background: { status: "ok" } });
	});

	it("answers status in process, without a session", async () => {
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

	it("answers unauthenticated to every action of its modules without a session, at <module>/<action>", async () => {
		const client = clientFor(
			{ notes: notesContract },
			{
				baseUrl: "http://domus",
				fetch: handler.fetch,
			},
		);

		await expect(client.notes.list()).rejects.toMatchObject({
			code: "UNAUTHORIZED",
			status: 401,
		});
		await expect(
			client.notes.add(undefined, { context: { idempotencyKey: "k1" } }),
		).rejects.toMatchObject({ code: "UNAUTHORIZED", status: 401 });
	});

	it("answers unauthenticated to a session cookie it did not sign", async () => {
		const response = await handler.fetch(
			new Request("http://domus/api/rpc/notes/list", {
				method: "POST",
				headers: { cookie: "better-auth.session_token=forged.token" },
			}),
		);
		expect(response.status).toBe(401);
	});

	it("publishes no other shape of an action's path", async () => {
		for (const path of ["/api/rpc/notes", "/api/rpc/notes.list", "/api/notes/list"]) {
			const response = await handler.fetch(
				new Request(`http://domus${path}`, { method: "POST" }),
			);
			expect(response.status, path).toBe(404);
		}
	});

	it("lets through only sign in and sign out of Better Auth's routes", async () => {
		for (const path of [
			"/api/auth/sign-up/email",
			"/api/auth/get-session",
			"/api/auth/list-sessions",
			"/api/auth/change-password",
			"/api/auth/update-user",
			"/api/auth/ok",
		]) {
			for (const method of ["GET", "POST"]) {
				const response = await handler.fetch(
					new Request(`http://domus${path}`, {
						method,
						headers: { origin: "http://domus" },
					}),
				);
				expect(response.status, `${method} ${path}`).toBe(404);
			}
		}
	});

	describe("with a session", () => {
		/** Signs Ana in and returns the cookies of her browser, as one Cookie header. */
		async function signInAna(cookie?: string): Promise<string> {
			const response = await handler.fetch(
				new Request("http://domus/api/auth/sign-in/email", {
					method: "POST",
					headers: {
						origin: "http://domus",
						"content-type": "application/json",
						...(cookie && { cookie }),
					},
					body: JSON.stringify({ email: "ana@domus.test", password: "a long password" }),
				}),
			);
			expect(response.status).toBe(200);
			return response.headers
				.getSetCookie()
				.map((line) => line.split(";")[0])
				.join("; ");
		}

		/** The device the server keeps for a session, by the account it belongs to. */
		const devicesOf = (account: string) =>
			connectionOf(platform)
				.prepare("SELECT device_id FROM platform_session WHERE user_id = ?")
				.pluck()
				.all(account);

		it("builds the verified context from the session alone, whatever the client declares", async () => {
			const ana = prepareAccount(platform, {
				name: "Ana",
				email: "ana@domus.test",
				role: "member",
			});
			await preparePassword(platform, ana, "a long password");
			const cookies = await signInAna();
			const [device] = devicesOf(ana);
			const invoke = vi.spyOn(actionsOf(platform), "invoke");

			try {
				const response = await handler.fetch(
					new Request("http://domus/api/rpc/notes/list", {
						method: "POST",
						headers: {
							origin: "http://domus",
							"content-type": "application/json",
							// A device cookie of another device, and headers that claim another identity.
							cookie: `${cookies}; domus.device=another-device`,
							"x-domus-account": "luis",
							"x-domus-via": "kira",
							"x-domus-device": "another-device",
							"x-domus-channel": "contexto",
							"x-domus-identity": "voice",
							"x-domus-conversation": "c1",
						},
						body: JSON.stringify({ json: { account: "luis", via: "kira" } }),
					}),
				);

				expect(response.status).toBe(200);
				expect(invoke).toHaveBeenCalledOnce();
				const [{ context }] = invoke.mock.calls[0]!;
				expect(context).toStrictEqual({
					account: ana,
					device,
					session: expect.any(String),
					deviceAccount: ana,
					channel: "app",
					identity: "password",
				});
				expect(Object.isFrozen(context)).toBe(true);
			} finally {
				invoke.mockRestore();
			}
		});

		it("keeps the session's device on the server: a later device cookie does not change it", async () => {
			const luis = prepareAccount(platform, {
				name: "Luis",
				email: "luis@domus.test",
				role: "member",
			});
			await preparePassword(platform, luis, "a long password");
			const response = await handler.fetch(
				new Request("http://domus/api/auth/sign-in/email", {
					method: "POST",
					headers: { origin: "http://domus", "content-type": "application/json" },
					body: JSON.stringify({ email: "luis@domus.test", password: "a long password" }),
				}),
			);
			const cookies = response.headers
				.getSetCookie()
				.map((line) => line.split(";")[0])
				.join("; ");
			const before = devicesOf(luis);

			await handler.fetch(
				new Request("http://domus/api/rpc/notes/list", {
					method: "POST",
					headers: { origin: "http://domus", cookie: `${cookies}; domus.device=x` },
				}),
			);

			expect(before).toHaveLength(1);
			expect(devicesOf(luis)).toEqual(before);
		});
	});

	it("refuses a module whose id is one of the platform's procedures", () => {
		const status = defineModule({ id: "status", schema: {}, migrations: [] });
		expect(() => createHttpHandler({ platform, modules: [status], auth })).toThrow(
			/procedure of the platform/,
		);
	});
});

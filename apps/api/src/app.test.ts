import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createTestPlatform } from "@domus/test-utils";
import { afterAll, describe, expect, it } from "vitest";

import { createApp } from "./app";
import { modules } from "./modules";

describe("api", () => {
	const test = createTestPlatform({ modules, file: true });
	afterAll(() => test.close());
	const app = createApp({
		webDir: undefined,
		platform: test.platform,
		modules,
		auth: { secret: "a-secret-only-for-the-tests-of-the-api", origins: ["http://localhost"] },
	});

	it("passes the health check to the door", async () => {
		const res = await app.request("/health");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			status: "ok",
			background: { status: "ok", backups: "off" },
		});
	});

	it("passes RPC calls to the door", async () => {
		const res = await app.request("/api/rpc/status", { method: "POST" });
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ json: { service: "domus" } });
	});

	it("passes Better Auth's sign-in route to the door", async () => {
		const res = await app.request("/api/auth/sign-in/email", {
			method: "POST",
			headers: { "content-type": "application/json", origin: "http://localhost" },
			body: JSON.stringify({ email: "nobody@domus.test", password: "a long password" }),
		});
		expect(res.status).toBe(401);
	});

	// The production module list is empty until phase 4; probe is a test module and stays out.
	it("publishes no RPC but status", async () => {
		for (const path of [
			"/api/rpc/nothing",
			"/api/rpc/probe/notes",
			"/api/rpc/platform/migrations",
		]) {
			const res = await app.request(path, { method: "POST" });
			expect(res.status, path).toBe(404);
		}
	});
});

describe("api with the built web app", () => {
	const test = createTestPlatform({ modules, file: true });
	const webDir = mkdtempSync(join(tmpdir(), "domus-web-"));
	writeFileSync(join(webDir, "index.html"), "<!doctype html><title>Domus</title>");
	afterAll(() => {
		test.close();
		rmSync(webDir, { recursive: true, force: true });
	});
	const app = createApp({
		webDir,
		platform: test.platform,
		modules,
		auth: { secret: "a-secret-only-for-the-tests-of-the-api", origins: ["http://localhost"] },
	});

	// Only the API's answers are never cached: the web app and /health keep what they had.
	it("marks the API's answers no-store, and neither the web app nor /health", async () => {
		const api = await app.request("/api/rpc/status", { method: "POST" });
		const page = await app.request("/");
		const route = await app.request("/lists");
		const health = await app.request("/health");

		expect(api.headers.get("cache-control")).toBe("no-store");
		for (const response of [page, route, health]) {
			expect(response.status).toBe(200);
			expect(response.headers.get("cache-control")).toBeNull();
		}
		expect(await page.text()).toContain("Domus");
	});
});

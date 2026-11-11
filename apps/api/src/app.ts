import { createHttpHandler } from "@domus/platform";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";

import type { ApiConfig } from "./config";

/** The program around the door: the door answers /health and /api, and the built web app is served here. */
export function createApp(config: Pick<ApiConfig, "webDir">): Hono {
	const door = createHttpHandler();
	const app = new Hono();

	app.get("/health", (c) => door.fetch(c.req.raw));
	app.all("/api/*", (c) => door.fetch(c.req.raw));

	if (config.webDir) {
		const root = config.webDir;
		app.use("/*", serveStatic({ root }));
		// Every other path is a route of the SPA.
		app.get("*", serveStatic({ root, path: "index.html" }));
	}

	return app;
}

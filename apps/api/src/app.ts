import { createHttpHandler, type HttpHandlerOptions } from "@domus/platform";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";

import type { ApiConfig } from "./config";

export interface AppOptions extends HttpHandlerOptions {
	readonly webDir: ApiConfig["webDir"];
}

/** The program around the door: the door answers /health and /api, and the built web app is served here. */
export function createApp({ webDir, ...doorOptions }: AppOptions): Hono {
	const door = createHttpHandler(doorOptions);
	const app = new Hono();

	app.get("/health", (c) => door.fetch(c.req.raw));
	app.all("/api/*", (c) => door.fetch(c.req.raw));

	if (webDir) {
		app.use("/*", serveStatic({ root: webDir }));
		// Every other path is a route of the SPA.
		app.get("*", serveStatic({ root: webDir, path: "index.html" }));
	}

	return app;
}

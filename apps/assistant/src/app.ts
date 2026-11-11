import { Hono } from "hono";

/** Kira, the part that thinks: receives conversations from the api and acts only by calling it. Today only the health check. */
export function createApp(): Hono {
	const app = new Hono();
	app.get("/health", (c) => c.json({ status: "ok" }));
	return app;
}

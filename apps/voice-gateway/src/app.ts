import { Hono } from "hono";

/** Satellites, wake word, speech to text and back, and who is speaking; talks only to the api. Today only the health check. */
export function createApp(): Hono {
	const app = new Hono();
	app.get("/health", (c) => c.json({ status: "ok" }));
	return app;
}

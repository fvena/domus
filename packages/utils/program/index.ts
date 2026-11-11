// What every Domus program does around its own work: read its settings from the environment,
// answer the health check, and stop cleanly on SIGINT or SIGTERM. Messages are for the operator,
// in English.
import { serve } from "@hono/node-server";
import { Hono } from "hono";

export function readPort(value: string | undefined, fallback: number): number {
	const port = Number(value ?? fallback);
	if (!Number.isInteger(port) || port <= 0) {
		throw new Error(`PORT must be a positive integer, got "${value}"`);
	}
	return port;
}

export function readUrl(value: string | undefined, name: string, example: string): URL {
	if (!value) throw new Error(`${name} is required (for example ${example})`);
	return new URL(value);
}

/** A server that only answers `GET /health`, for programs that take no other requests. */
export function createHealthApp(): Hono {
	const app = new Hono();
	app.get("/health", (c) => c.json({ status: "ok" }));
	return app;
}

export function serveHealth(
	port: number,
	onListening: (port: number) => void,
): () => Promise<void> {
	const server = serve({ fetch: createHealthApp().fetch, port }, (info) =>
		onListening(info.port),
	);
	return () => new Promise<void>((resolve) => server.close(() => resolve()));
}

/** Runs `stop` once on SIGINT or SIGTERM, then exits. */
export function onShutdown(stop: () => Promise<void> | void): void {
	for (const signal of ["SIGINT", "SIGTERM"] as const) {
		process.once(signal, async () => {
			await stop();
			process.exit(0);
		});
	}
}

import { serve } from "@hono/node-server";

import { createApp } from "./app";
import { readConfig } from "./config";

const config = readConfig();
const server = serve({ fetch: createApp(config).fetch, port: config.port }, ({ port }) => {
	console.log(`api listening on port ${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.on(signal, () => server.close(() => process.exit(0)));
}

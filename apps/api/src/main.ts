import { onShutdown } from "@domus/utils/program";
import { serve } from "@hono/node-server";

import { createApp } from "./app";
import { readConfig } from "./config";

const config = readConfig();
const server = serve({ fetch: createApp(config).fetch, port: config.port }, ({ port }) => {
	console.log(`api listening on port ${port}`);
});

onShutdown(() => new Promise<void>((resolve) => server.close(() => resolve())));

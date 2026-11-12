import { createPlatform } from "@domus/platform";
import { onShutdown } from "@domus/utils/program";
import { serve } from "@hono/node-server";

import { createApp } from "./app";
import { readConfig } from "./config";
import { modules } from "./modules";

const config = readConfig();
// If the database cannot be opened or migrated, this throws and api exits before opening its port.
const platform = createPlatform({ databaseFile: config.databaseFile, modules });
console.log(`database at ${config.databaseFile}: ${platform.appliedMigrations} migrations applied`);

const app = createApp({ webDir: config.webDir, platform, modules, auth: config.auth });
const server = serve({ fetch: app.fetch, port: config.port }, ({ port }) => {
	console.log(`api listening on port ${port}`);
});

onShutdown(async () => {
	await new Promise<void>((resolve) => server.close(() => resolve()));
	platform.close();
});

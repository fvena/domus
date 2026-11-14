import { createPlatform } from "@domus/platform";
import { onShutdown } from "@domus/utils/program";
import { serve } from "@hono/node-server";

import { createApp } from "./app";
import { readConfig } from "./config";
import { modules } from "./modules";

const config = readConfig();
// If the database cannot be opened or migrated, this throws and api exits before opening its port.
const platform = createPlatform({
	databaseFile: config.databaseFile,
	modules,
	// The first https one signs the notices (ADR 0029).
	origins: config.auth.origins,
	...(config.backups === undefined ? {} : { backups: config.backups }),
});
console.log(`database at ${config.databaseFile}: ${platform.appliedMigrations} migrations applied`);
console.log(
	config.backups === undefined ? "backups off" : `backups to ${config.backups.repository}`,
);

// The background starts after the database is ready and before serving (ADR 0025).
const { recovered } = platform.startBackground();
console.log(`scheduler started: ${recovered} jobs recovered`);

const app = createApp({ webDir: config.webDir, platform, modules, auth: config.auth });
const server = serve({ fetch: app.fetch, port: config.port }, ({ port }) => {
	console.log(`api listening on port ${port}`);
});

onShutdown(async () => {
	await new Promise<void>((resolve) => server.close(() => resolve()));
	// Running jobs are cancelled and awaited before the database closes.
	await platform.stopBackground();
	console.log("scheduler stopped");
	platform.close();
});

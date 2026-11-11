import { PROTOCOL } from "@domus/platform/contracts";
import { watchConnection } from "@domus/utils/connection";
import { serve } from "@hono/node-server";

import { checkApi } from "./api";
import { createApp } from "./app";
import { readConfig } from "./config";

const config = readConfig();

// Nothing that depends on the api runs unless `api.state` is "ready".
const api = watchConnection({
	check: checkApi({ baseUrl: config.apiUrl, fetch: (request) => fetch(request) }),
	onChange: (state) => {
		if (state === "incompatible") {
			console.error(
				`api at ${config.apiUrl.origin} does not speak protocol ${PROTOCOL}; waiting for a matching version`,
			);
		} else {
			console.log(`api at ${config.apiUrl.origin}: ${state}`);
		}
	},
});

const server = serve({ fetch: createApp().fetch, port: config.port }, ({ port }) => {
	console.log(`voice-gateway listening on port ${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.on(signal, () => {
		api.stop();
		server.close(() => process.exit(0));
	});
}

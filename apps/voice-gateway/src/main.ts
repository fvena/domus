import { PROTOCOL } from "@domus/platform/contracts";
import { watchConnection } from "@domus/utils/connection";
import { onShutdown, serveHealth } from "@domus/utils/program";

import { checkApi } from "./api";
import { readConfig } from "./config";

const config = readConfig();
const origin = config.apiUrl.origin;

// Nothing that depends on the api runs unless `api.state` is "ready".
const api = watchConnection({
	check: checkApi({ baseUrl: config.apiUrl, fetch: (request) => fetch(request) }),
	onChange: (state) => {
		if (state === "incompatible") {
			console.error(
				`api at ${origin} does not speak protocol ${PROTOCOL}; waiting for a matching version`,
			);
		} else {
			console.log(`api at ${origin}: ${state}`);
		}
	},
});

const closeHealth = serveHealth(config.port, (port) =>
	console.log(`voice-gateway listening on port ${port}`),
);

onShutdown(async () => {
	api.stop();
	await closeHealth();
});

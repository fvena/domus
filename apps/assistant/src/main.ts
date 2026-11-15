import { PROTOCOL } from "@domus/platform/contracts";
import { watchConnection } from "@domus/utils/connection";
import { onShutdown, serveHealth } from "@domus/utils/program";

import { APP, checkApi } from "./api";
import { readConfig } from "./config";

const config = readConfig();
const origin = config.apiUrl.origin;

/** Why the api rejects this program. It never repeats the key, which is read only at start. */
const rejection = `${
	config.key === undefined
		? `no key in ${config.keyFile}; create one with \`keys create ${APP}\``
		: `the key in ${config.keyFile} is not a good key of ${APP}`
}, then start assistant again (in Docker, recreate its container)`;

// Nothing that depends on the api runs unless `api.state` is "ready".
const api = watchConnection({
	check: checkApi({
		baseUrl: config.apiUrl,
		fetch: (request) => fetch(request),
		key: config.key,
	}),
	onChange: (state) => {
		if (state === "incompatible") {
			console.error(
				`api at ${origin} does not speak protocol ${PROTOCOL}; waiting for a matching version`,
			);
		} else if (state === "rejected") {
			console.error(`api at ${origin} rejects this program: ${rejection}`);
		} else {
			console.log(`api at ${origin}: ${state}`);
		}
	},
});

const closeHealth = serveHealth(config.port, (port) =>
	console.log(`assistant listening on port ${port}`),
);

onShutdown(async () => {
	api.stop();
	await closeHealth();
});

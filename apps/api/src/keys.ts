// `pnpm keys` (ADR 0030): creates, lists and revokes the keys of the connected apps, from a terminal or not. In the
// `api` container it runs as `node /app/keys.mjs`; on a development machine as `pnpm keys`. Only wiring: the
// platform reads the arguments and does the work, and this file opens the platform, with the shared lock as
// `accounts` does, and hands it stdout and stderr. stdout carries only the new key or the listing, so that
// `keys create kira > file` leaves the key alone in the file.
import { createPlatform, KEYS_USAGE, parseKeysArguments, runKeys } from "@domus/platform";

import { readDatabaseFile } from "./config";
import { modules } from "./modules";

const parsed = parseKeysArguments(process.argv.slice(2));
if ("error" in parsed) {
	console.error(`error: ${parsed.error}\n${KEYS_USAGE}`);
	process.exit(2);
}

const platform = createPlatform({ databaseFile: readDatabaseFile(), modules });
try {
	process.exitCode = runKeys(platform, parsed.command, {
		print: (line) => process.stdout.write(`${line}\n`),
		inform: (line) => console.error(line),
		fail: (line) => console.error(`error: ${line}`),
	});
} finally {
	platform.close();
}

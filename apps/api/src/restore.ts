// `restore.mjs` (ADR 0026): lists the snapshots of the backups, or restores one, with api stopped. In the container
// it runs as `node /app/restore.mjs`; on a development machine as `pnpm restore`. Only wiring: the platform reads
// the arguments and does the work, and nothing here reaches the cut points of its tests.
import { parseRestoreArguments, RESTORE_USAGE, runRestoreCommand } from "@domus/platform";

import { readRestoreConfig } from "./config";
import { modules } from "./modules";

const parsed = parseRestoreArguments(process.argv.slice(2));
if ("error" in parsed) {
	console.error(`error: ${parsed.error}\n${RESTORE_USAGE}`);
	process.exit(2);
}

const { databaseFile, backups } = readRestoreConfig();
void runRestoreCommand(
	parsed,
	{ databaseFile, modules, backups },
	{ print: (line) => console.log(line), fail: (line) => console.error(`error: ${line}`) },
).then((code) => {
	process.exitCode = code;
});

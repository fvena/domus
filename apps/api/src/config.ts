import { isAbsolute, join } from "node:path";

import { readPort } from "@domus/utils/program";

export interface ApiConfig {
	port: number;
	/** The built web app (apps/web/dist) the API serves as a SPA; unset in development, where Vite serves it. */
	webDir: string | undefined;
	/** `domus.db` inside `DOMUS_DATA_DIR`: `/data` in Docker, `<repo>/data` under `pnpm dev` (ADR 0021). */
	databaseFile: string;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
	return {
		port: readPort(env.PORT, 3000),
		webDir: env.DOMUS_WEB_DIR || undefined,
		databaseFile: join(readDataDir(env.DOMUS_DATA_DIR), "domus.db"),
	};
}

function readDataDir(value: string | undefined): string {
	if (!value) {
		throw new Error(
			"DOMUS_DATA_DIR is required: the absolute path of the data folder (for example /data)",
		);
	}
	if (!isAbsolute(value))
		throw new Error(`DOMUS_DATA_DIR must be an absolute path, got "${value}"`);
	return value;
}

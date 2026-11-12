import { isAbsolute, join } from "node:path";

import { readPort } from "@domus/utils/program";

export interface ApiConfig {
	port: number;
	/** The built web app (apps/web/dist) the API serves as a SPA; unset in development, where Vite serves it. */
	webDir: string | undefined;
	/** `domus.db` inside `DOMUS_DATA_DIR`: `/data` in Docker, `<repo>/data` under `pnpm dev` (ADR 0021). */
	databaseFile: string;
	/** How sessions are signed and where the app is served from (ADR 0023). */
	auth: {
		/** `DOMUS_AUTH_SECRET`: at least 32 characters, kept outside the repository. */
		secret: string;
		/** `DOMUS_ORIGINS`: the origins the app is served from, separated by commas. */
		origins: string[];
	};
}

const MIN_SECRET_LENGTH = 32;

export function readConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
	return {
		port: readPort(env.PORT, 3000),
		webDir: env.DOMUS_WEB_DIR || undefined,
		databaseFile: join(readDataDir(env.DOMUS_DATA_DIR), "domus.db"),
		auth: {
			secret: readSecret(env.DOMUS_AUTH_SECRET),
			origins: readOrigins(env.DOMUS_ORIGINS),
		},
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

/** Never echoes the value: it is a secret. */
function readSecret(value: string | undefined): string {
	if (!value || value.length < MIN_SECRET_LENGTH)
		throw new Error(
			`DOMUS_AUTH_SECRET is required, with at least ${MIN_SECRET_LENGTH} characters (for example the output of: openssl rand -base64 32)`,
		);
	return value;
}

function readOrigins(value: string | undefined): string[] {
	const origins = (value ?? "")
		.split(",")
		.map((origin) => origin.trim())
		.filter((origin) => origin !== "");
	if (origins.length === 0)
		throw new Error(
			"DOMUS_ORIGINS is required: the origins the app is served from, separated by commas (for example http://kira.local:3000)",
		);
	return origins.map((origin) => {
		let url: URL;
		try {
			url = new URL(origin);
		} catch {
			throw new Error(`DOMUS_ORIGINS has "${origin}", which is not a URL`);
		}
		if (url.origin !== origin)
			throw new Error(
				`DOMUS_ORIGINS has "${origin}": write only the origin, such as ${url.origin}`,
			);
		return origin;
	});
}

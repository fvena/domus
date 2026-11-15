import { readFileSync } from "node:fs";

import { readPort, readUrl } from "@domus/utils/program";

export interface AssistantConfig {
	port: number;
	/** Where the api listens. This program reaches Domus only through it, over HTTP. */
	apiUrl: URL;
	/** The file the key of this app was read from, to say where it was missing. */
	keyFile: string;
	/**
	 * The key of this app, read once at start (ADR 0030). Without one the program starts anyway, and the api
	 * rejects it until the file is right and the container is created again. Never printed.
	 */
	key: string | undefined;
}

/** The Docker secret `kira-key`, unless `DOMUS_API_KEY_FILE` names another file. */
const DEFAULT_KEY_FILE = "/run/secrets/kira-key";

/** The key in `file`, or none when it is missing, empty or cannot be read. */
function readKey(file: string): string | undefined {
	try {
		return readFileSync(file, "utf8").trim() || undefined;
	} catch {
		return undefined;
	}
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): AssistantConfig {
	const keyFile = env.DOMUS_API_KEY_FILE || DEFAULT_KEY_FILE;
	return {
		port: readPort(env.PORT, 3100),
		apiUrl: readUrl(env.DOMUS_API_URL, "DOMUS_API_URL", "http://api:3000"),
		keyFile,
		key: readKey(keyFile),
	};
}

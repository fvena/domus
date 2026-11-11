import { readPort, readUrl } from "@domus/utils/program";

export interface AssistantConfig {
	port: number;
	/** Where the api listens. This program reaches Domus only through it, over HTTP. */
	apiUrl: URL;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): AssistantConfig {
	return {
		port: readPort(env.PORT, 3100),
		apiUrl: readUrl(env.DOMUS_API_URL, "DOMUS_API_URL", "http://api:3000"),
	};
}

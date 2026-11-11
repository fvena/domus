import { readPort } from "@domus/utils/program";

export interface ApiConfig {
	port: number;
	/** The built web app (apps/web/dist) the API serves as a SPA; unset in development, where Vite serves it. */
	webDir: string | undefined;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
	return { port: readPort(env.PORT, 3000), webDir: env.DOMUS_WEB_DIR || undefined };
}

export interface ApiConfig {
	port: number;
	/** The built web app (apps/web/dist) the API serves as a SPA; unset in development, where Vite serves it. */
	webDir: string | undefined;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
	const port = Number(env.PORT ?? 3000);
	if (!Number.isInteger(port) || port <= 0)
		throw new Error(`PORT must be a positive integer, got "${env.PORT}"`);
	return { port, webDir: env.DOMUS_WEB_DIR || undefined };
}

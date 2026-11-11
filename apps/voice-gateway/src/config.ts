export interface Config {
	port: number;
	/** Where the api listens. This program reaches Domus only through it, over HTTP. */
	apiUrl: URL;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
	const port = Number(env.PORT ?? 3200);
	if (!Number.isInteger(port) || port <= 0)
		throw new Error(`PORT must be a positive integer, got "${env.PORT}"`);
	if (!env.DOMUS_API_URL)
		throw new Error("DOMUS_API_URL is required (for example http://api:3000)");
	return { port, apiUrl: new URL(env.DOMUS_API_URL) };
}

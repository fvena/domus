// What a Domus program does around its own work: read its port from the environment and stop cleanly
// on SIGINT or SIGTERM. Messages are for the operator, in English.

export function readPort(value: string | undefined, fallback: number): number {
	const port = Number(value ?? fallback);
	if (!Number.isInteger(port) || port <= 0) {
		throw new Error(`PORT must be a positive integer, got "${value}"`);
	}
	return port;
}

/** Runs `stop` once on SIGINT or SIGTERM, then exits. */
export function onShutdown(stop: () => Promise<void> | void): void {
	for (const signal of ["SIGINT", "SIGTERM"] as const) {
		process.once(signal, async () => {
			await stop();
			process.exit(0);
		});
	}
}

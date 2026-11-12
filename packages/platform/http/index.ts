// The door (ADR 0004, ADR 0020, ADR 0021): every request to Domus enters here. It answers the health
// check and the platform's RPC procedures. It takes the platform and the modules but publishes nothing of
// theirs: module actions reach HTTP only with authorization (phase 1c).
import type { ModuleDefinition } from "@domus/module-sdk";
import { implement } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { Hono } from "hono";

import { PROTOCOL, platformContract } from "../contracts";
import type { Platform } from "../platform";

export interface HttpHandler {
	/** A plain function, safe to pass around as `fetch`. */
	readonly fetch: (request: Request) => Promise<Response>;
}

/** Where RPC procedures live; @domus/api-client calls the same path. */
const RPC_PREFIX = "/api/rpc";

const procedures = implement(platformContract);

const router = procedures.router({
	status: procedures.status.handler(() => ({ service: "domus" as const, protocol: PROTOCOL })),
});

export interface HttpHandlerOptions {
	readonly platform: Platform;
	/** The modules the platform was opened with, in the same order. */
	readonly modules: readonly ModuleDefinition[];
}

export function createHttpHandler(_options: HttpHandlerOptions): HttpHandler {
	const rpc = new RPCHandler(router);
	const app = new Hono();

	app.get("/health", (c) => c.json({ status: "ok" }));

	app.all(`${RPC_PREFIX}/*`, async (c) => {
		const { matched, response } = await rpc.handle(c.req.raw, {
			prefix: RPC_PREFIX,
			context: {},
		});
		return matched ? c.newResponse(response.body, response) : c.notFound();
	});

	return { fetch: async (request) => app.fetch(request) };
}

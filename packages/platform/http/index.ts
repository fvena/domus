// The door (ADR 0004, ADR 0020): every request to Domus enters here. Today it answers the health
// check and the platform's RPC procedures; from phase 1 it also takes platform and the modules.
import { implement } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { Hono } from "hono";

import { PROTOCOL, platformContract } from "../contracts";

export interface HttpHandler {
	/** A plain function, safe to pass around as `fetch`. */
	readonly fetch: (request: Request) => Promise<Response>;
}

/** Where RPC procedures live; @domus/api-client calls the same path. */
const RPC_PREFIX = "/api/rpc";

const os = implement(platformContract);

const router = os.router({
	status: os.status.handler(() => ({ service: "domus" as const, protocol: PROTOCOL })),
});

export function createHttpHandler(): HttpHandler {
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

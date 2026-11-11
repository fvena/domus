// The API client: a thin oRPC link. It knows no contract of its own; callers pass the contract and
// get a typed client. Authentication and retries belong to the caller, not here.
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { AnyContractRouter, ContractRouterClient } from "@orpc/contract";

type Headers = Record<string, string>;

export interface Transport {
	/** Where the api listens, such as http://api:3000. In the browser it defaults to the page's origin. */
	baseUrl?: string | URL;
	fetch?: (request: Request) => Promise<Response>;
	/** A function is read on every call, for credentials that change. */
	headers?: Headers | (() => Headers | Promise<Headers>);
}

const RPC_PATH = "/api/rpc";

export function clientFor<T extends AnyContractRouter>(
	_contract: T,
	transport: Transport = {},
): ContractRouterClient<T> {
	const base =
		transport.baseUrl ?? (typeof location === "undefined" ? undefined : location.origin);
	if (base === undefined) {
		throw new Error("clientFor needs transport.baseUrl outside the browser");
	}
	const { fetch, headers } = transport;
	const link = new RPCLink({
		url: new URL(RPC_PATH, base),
		...(headers && { headers }),
		...(fetch && { fetch: (request: Request) => fetch(request) }),
	});
	return createORPCClient(link);
}

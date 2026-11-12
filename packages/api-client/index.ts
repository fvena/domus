// The API client: a thin oRPC link. It knows no contract of its own; callers pass the contract and
// get a typed client. Authentication and retries belong to the caller, not here: in the browser the session
// travels in its cookie; elsewhere the caller's `fetch` or `headers` carry it. A write's idempotency key goes
// in the call's context, `{ context: { idempotencyKey } }`, and travels as a header; so does the step-up proof of
// a sensitive operation, `{ context: { proof } }`.
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { AnyContractRouter, ContractRouterClient } from "@orpc/contract";

type HeaderValues = Record<string, string>;

export interface Transport {
	/** Where the api listens, such as http://api:3000. In the browser it defaults to the page's origin. */
	baseUrl?: string | URL;
	fetch?: (request: Request) => Promise<Response>;
	/** A function is read on every call, for credentials that change. */
	headers?: HeaderValues | (() => HeaderValues | Promise<HeaderValues>);
}

/** What a single call may add: the idempotency key of a write, and the step-up proof of a sensitive operation. */
export interface CallContext {
	idempotencyKey?: string;
	proof?: string;
}

const RPC_PATH = "/api/rpc";

/** The header the door reads a write's idempotency key from. */
const IDEMPOTENCY_KEY_HEADER = "idempotency-key";

/** The header the door reads a sensitive operation's step-up proof from. */
const PROOF_HEADER = "step-up-proof";

export function clientFor<T extends AnyContractRouter>(
	_contract: T,
	transport: Transport = {},
): ContractRouterClient<T, CallContext> {
	const base =
		transport.baseUrl ?? (typeof location === "undefined" ? undefined : location.origin);
	if (base === undefined) {
		throw new Error("clientFor needs transport.baseUrl outside the browser");
	}
	const { fetch, headers } = transport;
	const link = new RPCLink<CallContext>({
		url: new URL(RPC_PATH, base),
		headers: async ({ context }) => ({
			...(typeof headers === "function" ? await headers() : headers),
			...(context.idempotencyKey !== undefined && {
				[IDEMPOTENCY_KEY_HEADER]: context.idempotencyKey,
			}),
			...(context.proof !== undefined && { [PROOF_HEADER]: context.proof }),
		}),
		...(fetch && { fetch: (request: Request) => fetch(request) }),
	});
	return createORPCClient(link);
}

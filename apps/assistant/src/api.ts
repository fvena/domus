import { type CallContext, clientFor } from "@domus/api-client";
import {
	AUTHORIZATION_HEADER,
	bearerOf,
	KIRA,
	MANDATE_HEADER,
	PROTOCOL,
	platformContract,
} from "@domus/platform/contracts";
import type { CheckResult } from "@domus/utils/connection";
import { ORPCError } from "@orpc/client";
import type { AnyContractRouter, ContractRouterClient } from "@orpc/contract";

/** The connected app this program is, as the api names it when it accepts its key (ADR 0030). */
export const APP = KIRA;

/** How this program reaches the api: where it listens, the `fetch` to use and its key, if it has one. */
export interface ApiAccess {
	baseUrl: string | URL;
	fetch: (request: Request) => Promise<Response>;
	/** The key of this app. Without it every call that needs a credential is refused. */
	key: string | undefined;
}

/**
 * The client every call of this program goes through: its key in `Authorization` and, for a call on someone's
 * behalf, the mandate in `domus-mandate` (ADR 0030).
 */
export function apiClient<T extends AnyContractRouter>(
	contract: T,
	access: ApiAccess,
	mandate?: string,
): ContractRouterClient<T, CallContext> {
	return clientFor(contract, {
		baseUrl: access.baseUrl,
		fetch: access.fetch,
		headers: {
			...(access.key !== undefined && { [AUTHORIZATION_HEADER]: bearerOf(access.key) }),
			...(mandate !== undefined && { [MANDATE_HEADER]: mandate }),
		},
	});
}

/**
 * Whether the api answers in the protocol this program speaks, and accepts its key: ready only when `status` names
 * this app. Without a key, with a bad one or with another app's, it is rejected; another protocol is incompatible.
 */
export function checkApi(access: ApiAccess): (signal: AbortSignal) => Promise<CheckResult> {
	const client = apiClient(platformContract, access);
	return async (signal) => {
		try {
			const status = await client.status(undefined, { signal });
			if (status.protocol !== PROTOCOL) return "incompatible";
			return status.app === APP ? "ready" : "rejected";
		} catch (error) {
			if (error instanceof ORPCError && error.code === "UNAUTHORIZED") return "rejected";
			throw error;
		}
	};
}

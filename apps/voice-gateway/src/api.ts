import { clientFor, type Transport } from "@domus/api-client";
import { PROTOCOL, platformContract } from "@domus/platform/contracts";
import type { CheckResult } from "@domus/utils/connection";

/** Whether the api answers, and in the protocol this program speaks. */
export function checkApi(transport: Transport): (signal: AbortSignal) => Promise<CheckResult> {
	const client = clientFor(platformContract, transport);
	return async (signal) =>
		(await client.status(undefined, { signal })).protocol === PROTOCOL
			? "ready"
			: "incompatible";
}

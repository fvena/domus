import { clientFor, type Transport } from "@domus/api-client";
import { PROTOCOL, platformContract } from "@domus/platform/contracts";

/** Whether the api answers, and in the protocol this program speaks. */
export function checkApi(transport: Transport): () => Promise<"ready" | "incompatible"> {
	const client = clientFor(platformContract, transport);
	return async () => ((await client.status()).protocol === PROTOCOL ? "ready" : "incompatible");
}

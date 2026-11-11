// What platform answers over RPC, besides the modules. Pure: schemas and contracts only, so the
// browser, assistant and voice-gateway can import it (@domus/platform/contracts).
import { oc } from "@orpc/contract";
import { z } from "zod";

/**
 * Version of the contract between the api and the programs that call it. Raise it with any change
 * those programs cannot understand; they stop acting until both sides speak the same one.
 */
export const PROTOCOL = 1;

/** Public on purpose: it carries no personal data. Nothing else is public by default. */
export const statusContract = oc.output(
	z.object({
		service: z.literal("domus"),
		protocol: z.number().int(),
	}),
);

export const platformContract = {
	status: statusContract,
};

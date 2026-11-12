// The platform's own sensitive operations (ADR 0023): changing an account's permissions or delegation, and
// revoking another session or a device of the device account. Each one is a write of the platform's area on the
// path of the actions: authorization decides who may (permissions by role, the rest by the account they are
// about), it needs a step-up proof, takes a key and leaves its entry in the action log. What runs here is only
// the change, inside that write's transaction, once everything else said yes.
import { ORPCError } from "@orpc/server";
import type Database from "better-sqlite3";
import { z } from "zod";

import type { PlatformOperation } from "../actions";
import { endConfirmationsOnDevice } from "../actions/confirmations";
import { endProofsOnDevice } from "../actions/proofs";
import type { AreaPolicy } from "../authorization";
import { SENSITIVE_INPUTS } from "../contracts";
import { setGrant } from "./accounts";
import { setDelegation } from "./delegation";

type InputOf<TName extends keyof typeof SENSITIVE_INPUTS> = z.infer<
	(typeof SENSITIVE_INPUTS)[TName]
>;

/** The platform's sensitive operations on `connection`, over the registered `areas`. */
export function platformOperations(
	connection: Database.Database,
	areas: ReadonlyMap<string, AreaPolicy>,
): readonly PlatformOperation[] {
	const ownerOf = connection.prepare<[string], { account: string; device: string }>(
		"SELECT user_id AS account, device_id AS device FROM platform_session WHERE id = ?",
	);
	const deviceAccount = connection
		.prepare<[], string>("SELECT account FROM platform_roles WHERE role = 'device'")
		.pluck();
	/** An input whose area is a registered one. */
	const inArea = (schema: z.ZodObject<{ area: z.ZodString }>) =>
		schema.refine((input) => areas.has(input.area), {
			path: ["area"],
			message: "not a registered area",
		});
	/** Whose session it is: its owner, or, when there is none, the account that asks, which then finds nothing. */
	const sessionSubject = (input: unknown, context: { readonly account: string }) =>
		ownerOf.get((input as { session: string }).session)?.account ?? context.account;

	return [
		{
			name: "setPermission",
			sensitive: "permissions",
			inputSchema: inArea(SENSITIVE_INPUTS.setPermission),
			subject: (input) => (input as InputOf<"setPermission">).account,
			run: (input) => {
				const { account, area, level } = input as InputOf<"setPermission">;
				setGrant(connection, account, area, level);
				return { account, area, level };
			},
		},
		{
			name: "setDelegation",
			sensitive: "delegation",
			inputSchema: inArea(SENSITIVE_INPUTS.setDelegation),
			subject: (input) => (input as InputOf<"setDelegation">).account,
			run: (input) => {
				const { account, area, level, value } = input as InputOf<"setDelegation">;
				setDelegation(connection, account, area, level, value);
				return { account, area, level, value };
			},
		},
		{
			name: "revokeSession",
			sensitive: "sessions",
			inputSchema: SENSITIVE_INPUTS.revokeSession,
			subject: sessionSubject,
			run: (input, context) => {
				const { session } = input as InputOf<"revokeSession">;
				if (session === context.session)
					throw new ORPCError("BAD_REQUEST", {
						message: "the current session ends by signing out",
					});
				const found = ownerOf.get(session);
				// Authorization let the account reach only its own sessions, or the admin the device account's.
				if (!found) throw new ORPCError("NOT_FOUND", { message: "no such session" });
				// Its pending confirmations and proofs end with it: their session becomes null.
				connection.prepare("DELETE FROM platform_session WHERE id = ?").run(session);
				return { session };
			},
		},
		{
			name: "revokeDevice",
			sensitive: "sessions",
			inputSchema: SENSITIVE_INPUTS.revokeDevice,
			subject: sessionSubject,
			run: (input) => {
				const { session } = input as InputOf<"revokeDevice">;
				const found = ownerOf.get(session);
				if (!found || found.account !== deviceAccount.get())
					throw new ORPCError("NOT_FOUND", {
						message: "no device of the device account",
					});
				// Every session of that device, whoever's, and what was asked from it; then the device itself, so
				// its cookie names none and a new sign-in there starts a new one.
				const ended = connection
					.prepare("DELETE FROM platform_session WHERE device_id = ?")
					.run(found.device).changes;
				endProofsOnDevice(connection, found.device);
				endConfirmationsOnDevice(connection, found.device);
				connection.prepare("DELETE FROM platform_devices WHERE id = ?").run(found.device);
				return { endedSessions: ended };
			},
		},
	];
}

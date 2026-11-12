// The platform's own operations on the path of the actions (ADR 0023). Reading an account's delegation is a read
// of the platform's area. The sensitive ones change an account's permissions or delegation, or revoke another
// session or a device of the device account: each one is a write of the platform's area that needs a step-up
// proof, takes a key and leaves its entry in the action log. Authorization decides who may (permissions by role,
// the rest by the account they are about). What runs here is only the read or the change, inside that read or
// write, once everything else said yes.
import { PLATFORM_ID } from "@domus/module-sdk";
import { ORPCError } from "@orpc/server";
import type Database from "better-sqlite3";
import { z } from "zod";

import type { PlatformOperation } from "../actions";
import { endConfirmationsOnDevice } from "../actions/confirmations";
import { endProofsOnDevice } from "../actions/proofs";
import { type AreaPolicy, reachesSettingsOf, type VerifiedContext } from "../authorization";
import { READ_DELEGATION_INPUT, SENSITIVE_INPUTS } from "../contracts";
import { accessView } from "./access";
import { setGrant } from "./accounts";
import { delegationTable, setDelegation } from "./delegation";
import { sessionLookup } from "./sessions";

/** One operation with its input typed by its schema, which the path of the actions validates before either runs. */
interface TypedOperation<TSchema extends z.ZodType> extends Omit<
	PlatformOperation,
	"inputSchema" | "subject" | "find" | "run"
> {
	readonly inputSchema: TSchema;
	readonly subject: (input: z.infer<TSchema>, context: VerifiedContext) => string | undefined;
	readonly find?: (input: z.infer<TSchema>, context: VerifiedContext) => void;
	readonly run: (input: z.infer<TSchema>, context: VerifiedContext) => unknown;
}

/** An operation as the path of the actions takes it, which hands each function only the input its schema accepted. */
function operation<TSchema extends z.ZodType>(typed: TypedOperation<TSchema>): PlatformOperation {
	return typed as unknown as PlatformOperation;
}

/** The platform's operations on `connection`, over the registered `areas`. */
export function platformOperations(
	connection: Database.Database,
	areas: ReadonlyMap<string, AreaPolicy>,
): readonly PlatformOperation[] {
	const sessionById = sessionLookup(connection);
	const view = accessView(connection, areas);
	const deviceAccount = connection
		.prepare<[], string>("SELECT account FROM platform_roles WHERE role = 'device'")
		.pluck();
	/** An input whose area is a registered one. */
	const inArea = <TInput extends { area: string }>(schema: z.ZodType<TInput>) =>
		schema.refine((input) => areas.has(input.area), {
			path: ["area"],
			message: "not a registered area",
		});
	/** Whose session it is: its owner, or, when there is none, the account that asks, which then finds nothing. */
	const sessionSubject = ({ session }: { session: string }, context: VerifiedContext) =>
		sessionById(session)?.account ?? context.account;

	return [
		operation({
			name: "readDelegation",
			kind: "read",
			inputSchema: READ_DELEGATION_INPUT,
			subject: ({ account }) => account,
			run: ({ account }) => delegationTable(connection, areas, account),
		}),
		operation({
			name: "setPermission",
			sensitive: "permissions",
			// The platform's area holds each account's own settings, its delegation, sessions and log: no permission
			// on it is ever changed, so nobody's can be frozen.
			inputSchema: inArea(SENSITIVE_INPUTS.setPermission).refine(
				(input) => input.area !== PLATFORM_ID,
				{ path: ["area"], message: "the platform's area is not granted" },
			),
			subject: ({ account }) => account,
			run: ({ account, area, level }) => {
				setGrant(connection, account, area, level);
				return { account, area, level };
			},
		}),
		operation({
			name: "setDelegation",
			sensitive: "delegation",
			inputSchema: inArea(SENSITIVE_INPUTS.setDelegation),
			subject: ({ account }) => account,
			run: ({ account, area, level, value }) => {
				setDelegation(connection, account, area, level, value);
				return { account, area, level, value };
			},
		}),
		operation({
			name: "revokeSession",
			sensitive: "sessions",
			inputSchema: SENSITIVE_INPUTS.revokeSession,
			subject: sessionSubject,
			// One that does not exist and one out of reach (another account's, but the device account's for the
			// admin) answer the same, before anything asks for a proof: nothing tells them apart.
			find: ({ session }, context) => {
				const found = sessionById(session);
				if (!found || !reachesSettingsOf(view, context.account, found.account))
					throw new ORPCError("NOT_FOUND", { message: "no such session" });
			},
			run: ({ session }, context) => {
				if (session === context.session)
					throw new ORPCError("BAD_REQUEST", {
						message: "the current session ends by signing out",
					});
				// Its pending confirmations and proofs end with it: their session becomes null.
				connection.prepare("DELETE FROM platform_session WHERE id = ?").run(session);
				return { session };
			},
		}),
		operation({
			name: "revokeDevice",
			sensitive: "sessions",
			inputSchema: SENSITIVE_INPUTS.revokeDevice,
			subject: sessionSubject,
			run: ({ session }) => {
				const found = sessionById(session);
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
		}),
	];
}

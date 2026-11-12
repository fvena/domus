// The door (ADR 0004, ADR 0020, ADR 0023): every request to Domus enters here. It answers the health check,
// lets through the routes of Better Auth that Domus uses (sign in and sign out), and serves over oRPC the
// platform's procedures and the actions of the modules it receives, at `<module>/<action>`. Each action needs a
// valid session: the door builds the verified context from it, ignores anything the client declares about who
// it is, and hands it to the one path of the actions. So do the platform's own operations on one's password
// (it asks for the current one and keeps only this session), sessions (only one's own, with their device),
// pending confirmations (confirming or rejecting one's own, by the app), step-up proofs (asking for one with
// the password), delegation (reading one's own, or the device account's as admin) and the action log (reading
// one's own annotations, undoing one's own entry). The sensitive ones (changing permissions and delegation,
// revoking sessions and devices) are writes on that same path, and so are the settings of the scheduled tasks
// (ADR 0025: listing them, a read; changing a time, pausing, resuming and launching, `manage` writes). A write's idempotency key and a sensitive operation's step-up proof come in headers.
import type { ModuleDefinition } from "@domus/module-sdk";
import { implement, ORPCError, os } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { Hono } from "hono";

import { READ_DELEGATION, READ_LOG } from "../actions";
import { sealContext, type VerifiedContext } from "../authorization";
import { LIST_TASKS } from "../background/operations";
import { PROTOCOL, platformContract } from "../contracts";
import { AUTH_PREFIX, type AuthOptions, createAuth } from "../identity/auth";
import { replacePassword, SessionGoneError, verifiedPasswordHash } from "../identity/passwords";
import { requestProof, WrongPasswordError } from "../identity/proofs";
import { sessionsOf } from "../identity/sessions";
import {
	actionsOf,
	backgroundOf,
	clockOf,
	connectionOf,
	type Platform,
	proofIssuerOf,
} from "../platform";

export interface HttpHandler {
	/** A plain function, safe to pass around as `fetch`. */
	readonly fetch: (request: Request) => Promise<Response>;
}

/** Where RPC procedures live; @domus/api-client calls the same path. */
const RPC_PREFIX = "/api/rpc";

/** The header that carries a write's idempotency key; @domus/api-client sends it from the call's context. */
const IDEMPOTENCY_KEY_HEADER = "idempotency-key";

/** The header that carries a sensitive operation's step-up proof; @domus/api-client sends it from the call's context. */
const PROOF_HEADER = "step-up-proof";

/** The only routes of Better Auth the door lets through: everything else of it answers 404. */
const AUTH_ROUTES: readonly string[] = ["/sign-in/email", "/sign-out"];

export interface HttpHandlerOptions {
	readonly platform: Platform;
	/** The modules the platform was opened with, in the same order. */
	readonly modules: readonly ModuleDefinition[];
	/** How sessions are signed and which origins the app is served from. */
	readonly auth: AuthOptions;
}

/** What each RPC call carries: who it comes from, once a procedure asks, its idempotency key and its proof. */
interface DoorContext {
	readonly verify: () => Promise<VerifiedContext | null>;
	readonly idempotencyKey: string | undefined;
	readonly proof: string | undefined;
}

const platformProcedures = implement(platformContract).$context<DoorContext>();
const actionProcedure = os.$context<DoorContext>();

export function createHttpHandler({ platform, modules, auth }: HttpHandlerOptions): HttpHandler {
	const connection = connectionOf(platform);
	const identity = createAuth(connection, auth);
	const actions = actionsOf(platform);

	/**
	 * Runs the platform's write `platform.<name>` on the path of the actions with a session, its key and its proof:
	 * the sensitive ones and the `manage` settings of the scheduled tasks.
	 */
	async function platformWrite(
		name: string,
		input: unknown,
		context: DoorContext,
	): Promise<never> {
		return actions.invoke({
			context: await verifiedSession(context),
			action: `platform.${name}`,
			input,
			idempotencyKey: context.idempotencyKey,
			proof: context.proof,
		}) as never;
	}

	/** The verified context of a platform operation, which always needs a session. */
	async function verifiedSession(context: DoorContext): Promise<VerifiedContext> {
		const verified = await context.verify();
		if (!verified?.session) throw new ORPCError("UNAUTHORIZED");
		return verified;
	}

	/** The account and session of a platform operation on one's own password or sessions. */
	async function signedIn(
		context: DoorContext,
	): Promise<{ readonly account: string; readonly session: string }> {
		const { account, session = "" } = await verifiedSession(context);
		return { account, session };
	}

	const moduleRouters: Record<string, Record<string, unknown>> = {};
	for (const module of modules) {
		if (module.id in platformContract)
			throw new Error(`module "${module.id}": its id is a procedure of the platform`);
		moduleRouters[module.id] = Object.fromEntries(
			Object.keys(module.contract ?? {}).map((name) => [
				name,
				actionProcedure.handler(async ({ input, context }) => {
					const verified = await context.verify();
					if (!verified) throw new ORPCError("UNAUTHORIZED");
					return actions.invoke({
						context: verified,
						action: `${module.id}.${name}`,
						input,
						idempotencyKey: context.idempotencyKey,
						proof: context.proof,
					});
				}),
			]),
		);
	}

	const rpc = new RPCHandler({
		...moduleRouters,
		status: platformProcedures.status.handler(() => ({
			service: "domus" as const,
			protocol: PROTOCOL,
		})),
		password: {
			change: platformProcedures.password.change.handler(
				async ({ input, context, errors }) => {
					const { account, session } = await signedIn(context);
					if (
						(await verifiedPasswordHash(connection, account, input.currentPassword)) ===
						undefined
					)
						throw errors.FORBIDDEN({ data: { reason: "wrong-password" } });
					try {
						const endedSessions = await replacePassword(
							connection,
							account,
							input.newPassword,
							clockOf(platform)(),
							session,
						);
						return { endedSessions };
					} catch (error) {
						if (error instanceof SessionGoneError) throw new ORPCError("UNAUTHORIZED");
						throw error;
					}
				},
			),
		},
		sessions: {
			list: platformProcedures.sessions.list.handler(async ({ context }) => {
				const { account, session } = await signedIn(context);
				return sessionsOf(connection, account, session);
			}),
			revoke: platformProcedures.sessions.revoke.handler(({ input, context }) =>
				platformWrite("revokeSession", input, context),
			),
		},
		devices: {
			revoke: platformProcedures.devices.revoke.handler(({ input, context }) =>
				platformWrite("revokeDevice", input, context),
			),
		},
		permissions: {
			set: platformProcedures.permissions.set.handler(({ input, context }) =>
				platformWrite("setPermission", input, context),
			),
		},
		delegation: {
			read: platformProcedures.delegation.read.handler(
				async ({ input, context }) =>
					actions.invoke({
						context: await verifiedSession(context),
						action: READ_DELEGATION,
						input,
					}) as never,
			),
			set: platformProcedures.delegation.set.handler(({ input, context }) =>
				platformWrite("setDelegation", input, context),
			),
		},
		proofs: {
			request: platformProcedures.proofs.request.handler(
				async ({ input, context, errors }) => {
					try {
						return await requestProof(
							proofIssuerOf(platform),
							await verifiedSession(context),
							input,
						);
					} catch (error) {
						if (error instanceof WrongPasswordError)
							throw errors.FORBIDDEN({ data: { reason: "wrong-password" } });
						throw error;
					}
				},
			),
		},
		log: {
			read: platformProcedures.log.read.handler(
				async ({ context }) =>
					actions.invoke({
						context: await verifiedSession(context),
						action: READ_LOG,
					}) as never,
			),
			undo: platformProcedures.log.undo.handler(async ({ input, context }) =>
				actions.undo({
					context: await verifiedSession(context),
					entry: input.entry,
					idempotencyKey: context.idempotencyKey ?? "",
					...(context.proof === undefined ? {} : { proof: context.proof }),
				}),
			),
		},
		tasks: {
			list: platformProcedures.tasks.list.handler(
				async ({ context }) =>
					actions.invoke({
						context: await verifiedSession(context),
						action: LIST_TASKS,
					}) as never,
			),
			setTime: platformProcedures.tasks.setTime.handler(({ input, context }) =>
				platformWrite("setTaskTime", input, context),
			),
			pause: platformProcedures.tasks.pause.handler(({ input, context }) =>
				platformWrite("pauseTask", input, context),
			),
			resume: platformProcedures.tasks.resume.handler(({ input, context }) =>
				platformWrite("resumeTask", input, context),
			),
			launch: platformProcedures.tasks.launch.handler(({ input, context }) =>
				platformWrite("launchTask", input, context),
			),
		},
		confirmations: {
			confirm: platformProcedures.confirmations.confirm.handler(async ({ input, context }) =>
				actions.confirm({
					context: await verifiedSession(context),
					confirmation: input.id,
					...(context.proof === undefined ? {} : { proof: context.proof }),
				}),
			),
			reject: platformProcedures.confirmations.reject.handler(async ({ input, context }) => {
				actions.reject({ context: await verifiedSession(context), confirmation: input.id });
			}),
		},
	});
	const app = new Hono();

	// 200 while the process answers, which is what Docker's health check watches; the background's field is the
	// watcher's, public and without personal data (ADR 0025).
	app.get("/health", (c) =>
		c.json({ status: "ok", background: backgroundOf(platform).health() }),
	);

	app.post(`${AUTH_PREFIX}/*`, (c) =>
		AUTH_ROUTES.includes(c.req.path.slice(AUTH_PREFIX.length))
			? identity.handler(c.req.raw)
			: c.notFound(),
	);

	app.all(`${RPC_PREFIX}/*`, async (c) => {
		const request = c.req.raw;
		const responseHeaders = new Headers();
		let verified: Promise<VerifiedContext | null> | undefined;
		const { matched, response } = await rpc.handle(request, {
			prefix: RPC_PREFIX,
			context: {
				// Read once per request, only when a procedure needs it: status works without a session.
				verify: () => (verified ??= contextOf(request, responseHeaders)),
				idempotencyKey: request.headers.get(IDEMPOTENCY_KEY_HEADER) ?? undefined,
				proof: request.headers.get(PROOF_HEADER) ?? undefined,
			},
		});
		if (!matched) return c.notFound();
		const answer = c.newResponse(response.body, response);
		for (const cookie of responseHeaders.getSetCookie())
			answer.headers.append("set-cookie", cookie);
		return answer;
	});

	/**
	 * The verified context of a request, from its session alone. Over HTTP, in phase 1c, the account is the
	 * session's and asks itself: no via, the app channel, proven by password, no conversation.
	 */
	async function contextOf(
		request: Request,
		responseHeaders: Headers,
	): Promise<VerifiedContext | null> {
		const session = await identity.sessionOf(request, responseHeaders);
		if (!session) return null;
		return sealContext({
			account: session.account,
			device: session.device,
			session: session.id,
			deviceAccount: session.account,
			channel: "app",
			identity: "password",
		});
	}

	return { fetch: async (request) => app.fetch(request) };
}

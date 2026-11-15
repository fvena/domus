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
// (ADR 0025: listing them, a read; changing a time, pausing, resuming and launching, `manage` writes) and the test
// notice (ADR 0029: a person's own irreversible write, with no level of any area). A write's idempotency key and a sensitive operation's step-up proof come in headers.
// Besides oRPC, routes of Hono only with a session: uploading and downloading files (ADR 0028), the live channel, the public key
// of VAPID and the device's subscription to notices (ADR 0029).
// The key of a connected app comes in `Authorization: Bearer` (ADR 0030). With a good one `status` says which app
// calls; a bad one, or one next to the session cookie, is refused, never taken as no credential. With a good key
// and a mandate in `domus-mandate`, the actions of the modules run on the person's behalf: the door seals the
// context the mandate keeps, with `via` the key's app and the channel `contexto`. Every operation of the platform
// takes it too, and authorization decides what a context with `via` reaches: of the platform's, only `log/read` and
// `log/undo` (ADR 0034). Every route of Hono and of Better Auth refuses a key.
// A mandate without a key is refused on every route too, `status` included: it never falls back to the session.
import type { ModuleDefinition } from "@domus/module-sdk";
import { implement, ORPCError, os } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { getSessionCookie } from "better-auth/cookies";
import { type Context, Hono } from "hono";

import { READ_DELEGATION, READ_LOG } from "../actions";
import { internalError } from "../actions/failures";
import { asksByItself, sealContext, type VerifiedContext } from "../authorization";
import { LIST_TASKS } from "../background/operations";
import { AUTHORIZATION_HEADER, MANDATE_HEADER, PROTOCOL, platformContract } from "../contracts";
import { contentDisposition, errorResponse } from "../files";
import { AUTH_PREFIX, type AuthOptions, createAuth } from "../identity/auth";
import { checkKey, noteKeyUse, readAuthorization } from "../identity/keys";
import { readMandate, resolveMandate } from "../identity/mandates";
import { replacePassword, SessionGoneError, verifiedPasswordHash } from "../identity/passwords";
import { requestProof, WrongPasswordError } from "../identity/proofs";
import { originOf, sessionsOf } from "../identity/sessions";
import { TEST_NOTICE } from "../notifications/operations";
import {
	actionsOf,
	appsOf,
	backgroundOf,
	clockOf,
	connectionOf,
	eventsOf,
	filesOf,
	interleaveOf,
	notificationsOf,
	type Platform,
	proofIssuerOf,
} from "../platform";

export interface HttpHandler {
	/** A plain function, safe to pass around as `fetch`. */
	readonly fetch: (request: Request) => Promise<Response>;
}

/** Where the API lives: every answer under it is marked `no-store`. */
const API_PREFIX = "/api";

/** Where a file is uploaded (ADR 0028): a route of Hono, not of oRPC, to control its receipt. */
const FILES_PATH = "/api/files";

/** Where a file is downloaded through the read that returns it (ADR 0028). */
const DOWNLOAD_PATH = "/api/files/download";

/** The public key of VAPID (ADR 0029). */
const NOTIFICATIONS_KEY_PATH = "/api/notifications/key";

/** The subscription of the session's device to notices (ADR 0029): put to subscribe, deleted to unsubscribe. */
const SUBSCRIPTION_PATH = "/api/notifications/subscription";
/** Where a session opens its live channel (ADR 0029): a route of Hono that streams server-sent events. */
const EVENTS_PATH = "/api/events";

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
	/**
	 * The operator's log, for why a key or a mandate was refused, never with either: `console.warn` unless given (ADR
	 * 0030).
	 */
	readonly log?: (line: string) => void;
}

/**
 * What each RPC call carries: who it comes from and which app's key it has, once a procedure asks, its idempotency key
 * and its proof. Who it comes from is a session's context, or with `mandate` also the one a mandate keeps, which the
 * actions of the modules and the operations of the platform admit, for authorization to decide.
 */
interface DoorContext {
	readonly verify: (admits?: { readonly mandate?: boolean }) => Promise<VerifiedContext | null>;
	readonly app: () => string | undefined;
	readonly idempotencyKey: string | undefined;
	readonly proof: string | undefined;
}

/** A call to an operation of the platform as its handler receives it: the door's context. */
interface OperationCall {
	readonly context: DoorContext;
}

const platformProcedures = implement(platformContract).$context<DoorContext>();
const actionProcedure = os.$context<DoorContext>();

export function createHttpHandler({
	platform,
	modules,
	auth,
	log = console.warn,
}: HttpHandlerOptions): HttpHandler {
	const connection = connectionOf(platform);
	const notifications = notificationsOf(platform);
	const interleave = interleaveOf(platform);
	const events = eventsOf(platform);
	const identity = createAuth(connection, auth, {
		entering: () => interleave?.("entering"),
		entered: (session) => notifications.entered(session),
		ended: events.sessionsEnded,
	});
	const actions = actionsOf(platform);
	const files = filesOf(platform);
	// What an earlier process left half uploaded goes before the door admits a request (ADR 0028).
	files?.clearIncoming();

	/**
	 * Runs the platform's write `platform.<name>` on the path of the actions with a session, its key and its proof:
	 * the sensitive ones and the `manage` settings of the scheduled tasks.
	 */
	async function platformWrite(
		name: string,
		call: OperationCall & { readonly input?: unknown },
	): Promise<never> {
		return actions.invoke({
			context: await sessionOrMandateContext(call),
			action: `platform.${name}`,
			input: call.input,
			idempotencyKey: call.context.idempotencyKey,
			proof: call.context.proof,
		}) as never;
	}

	/**
	 * The verified context of an operation of the platform: a session's, or a mandate's, with a session either way.
	 * Authorization decides what a context with `via` reaches (ADR 0034): the door keeps no list of its own.
	 */
	async function sessionOrMandateContext({ context }: OperationCall): Promise<VerifiedContext> {
		const verified = await context.verify({ mandate: true });
		if (!verified?.session) throw new ORPCError("UNAUTHORIZED");
		return verified;
	}

	/**
	 * The account and session of a platform operation on one's own password or sessions, which stays outside the path
	 * of the actions: only by the person by itself, never via an agent (ADR 0034).
	 */
	async function signedIn(
		call: OperationCall,
	): Promise<{ readonly account: string; readonly session: string }> {
		const verified = await sessionOrMandateContext(call);
		if (!asksByItself(verified)) throw new ORPCError("FORBIDDEN");
		const { account, session = "" } = verified;
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
					const verified = await context.verify({ mandate: true });
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
		// Public without a credential; with a good key it also says which app calls, and a bad one is refused.
		status: platformProcedures.status.handler(({ context }) => {
			const app = context.app();
			return {
				service: "domus" as const,
				protocol: PROTOCOL,
				...(app === undefined ? {} : { app }),
			};
		}),
		password: {
			change: platformProcedures.password.change.handler(async (call) => {
				const { input, errors } = call;
				const { account, session } = await signedIn(call);
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
						clockOf(platform),
						{ keep: session, ended: events.sessionsEnded },
					);
					return { endedSessions };
				} catch (error) {
					if (error instanceof SessionGoneError) throw new ORPCError("UNAUTHORIZED");
					throw error;
				}
			}),
		},
		sessions: {
			list: platformProcedures.sessions.list.handler(async (call) => {
				const { account, session } = await signedIn(call);
				return sessionsOf(connection, account, session);
			}),
			revoke: platformProcedures.sessions.revoke.handler((call) =>
				platformWrite("revokeSession", call),
			),
		},
		devices: {
			revoke: platformProcedures.devices.revoke.handler((call) =>
				platformWrite("revokeDevice", call),
			),
		},
		permissions: {
			set: platformProcedures.permissions.set.handler((call) =>
				platformWrite("setPermission", call),
			),
		},
		delegation: {
			read: platformProcedures.delegation.read.handler(
				async (call) =>
					actions.invoke({
						context: await sessionOrMandateContext(call),
						action: READ_DELEGATION,
						input: call.input,
					}) as never,
			),
			set: platformProcedures.delegation.set.handler((call) =>
				platformWrite("setDelegation", call),
			),
		},
		proofs: {
			request: platformProcedures.proofs.request.handler(async (call) => {
				try {
					return await requestProof(
						proofIssuerOf(platform),
						await sessionOrMandateContext(call),
						call.input,
					);
				} catch (error) {
					if (error instanceof WrongPasswordError)
						throw call.errors.FORBIDDEN({ data: { reason: "wrong-password" } });
					throw error;
				}
			}),
		},
		// With a session, or with a key and a mandate: the two operations of the platform authorization lets a context
		// with `via` reach, through the delegation in force.
		log: {
			read: platformProcedures.log.read.handler(
				async (call) =>
					actions.invoke({
						context: await sessionOrMandateContext(call),
						action: READ_LOG,
					}) as never,
			),
			undo: platformProcedures.log.undo.handler(async (call) =>
				actions.undo({
					context: await sessionOrMandateContext(call),
					entry: call.input.entry,
					idempotencyKey: call.context.idempotencyKey ?? "",
					...(call.context.proof === undefined ? {} : { proof: call.context.proof }),
				}),
			),
		},
		notifications: {
			test: platformProcedures.notifications.test.handler((call) =>
				platformWrite(TEST_NOTICE, call),
			),
		},
		tasks: {
			list: platformProcedures.tasks.list.handler(
				async (call) =>
					actions.invoke({
						context: await sessionOrMandateContext(call),
						action: LIST_TASKS,
					}) as never,
			),
			setTime: platformProcedures.tasks.setTime.handler((call) =>
				platformWrite("setTaskTime", call),
			),
			pause: platformProcedures.tasks.pause.handler((call) =>
				platformWrite("pauseTask", call),
			),
			resume: platformProcedures.tasks.resume.handler((call) =>
				platformWrite("resumeTask", call),
			),
			launch: platformProcedures.tasks.launch.handler((call) =>
				platformWrite("launchTask", call),
			),
		},
		// Kira never confirms nor rejects (ADR 0030, ADR 0034): answering denies a context with `via`.
		confirmations: {
			confirm: platformProcedures.confirmations.confirm.handler(async (call) =>
				actions.confirm({
					context: await sessionOrMandateContext(call),
					confirmation: call.input.id,
					...(call.context.proof === undefined ? {} : { proof: call.context.proof }),
				}),
			),
			reject: platformProcedures.confirmations.reject.handler(async (call) => {
				actions.reject({
					context: await sessionOrMandateContext(call),
					confirmation: call.input.id,
				});
			}),
		},
	});
	const app = new Hono();

	// No answer of the API is kept in a cache, of the browser or of anything in between: neither a good one nor an
	// error, Better Auth's included.
	app.use(`${API_PREFIX}/*`, async (c, next) => {
		await next();
		c.res.headers.set("cache-control", "no-store");
	});

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
		let bySession: Promise<VerifiedContext | null> | undefined;
		let byMandate: Promise<VerifiedContext | null> | undefined;
		const { matched, response } = await rpc.handle(request, {
			prefix: RPC_PREFIX,
			context: {
				// Read once per request, only when a procedure needs it: status works without a session.
				verify: ({ mandate = false } = {}) =>
					mandate
						? (byMandate ??= contextOf(request, responseHeaders, { mandate }))
						: (bySession ??= contextOf(request, responseHeaders)),
				app: () => appOf(request),
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
	 * A route of Hono only with a session, of files (ADR 0028), the live channel or notices (ADR 0029): what `answer`
	 * gives, or the error of the spec's table as the JSON of ORPCError without the RPC envelope; either way with the
	 * cookies that reading the session set.
	 */
	const sessionRoute =
		(answer: (verified: VerifiedContext, request: Request, c: Context) => Promise<Response>) =>
		async (c: Context): Promise<Response> => {
			const responseHeaders = new Headers();
			let response: Response;
			try {
				const verified = await contextOf(c.req.raw, responseHeaders);
				if (!verified?.session) throw new ORPCError("UNAUTHORIZED");
				response = await answer(verified, c.req.raw, c);
			} catch (error) {
				response = errorResponse(error);
			}
			for (const cookie of responseHeaders.getSetCookie())
				response.headers.append("set-cookie", cookie);
			return response;
		};

	// Uploading a file: who may upload, authorization decides. The answer is the prepared file.
	app.post(
		FILES_PATH,
		sessionRoute(async (verified, request) => {
			if (!files) throw internalError();
			return Response.json(await files.upload(verified, request));
		}),
	);

	// Downloading a file: a read of a module on the path of the actions, which must return the file at a position
	// marked with `fileRef()`. The input never goes in the URL. The bytes go after its transaction, never cached.
	// A download whose read asks for confirmation waits, and is confirmed here alone, with `{ confirmation }`.
	app.post(
		DOWNLOAD_PATH,
		sessionRoute(async (verified, request) => {
			const body = downloadRequest(await request.json().catch(() => undefined));
			const proof = request.headers.get(PROOF_HEADER) ?? undefined;
			const download =
				"confirmation" in body
					? actions.confirmDownload({
							context: verified,
							confirmation: body.confirmation,
							...(proof === undefined ? {} : { proof }),
						})
					: actions.download({
							context: verified,
							...body,
							...(proof === undefined ? {} : { proof }),
						});
			// Only a test waits here: the file open, the transaction ended, no byte sent.
			try {
				await files?.opened();
			} catch (error) {
				download.content.close();
				throw error;
			}
			return new Response(download.content.stream(), {
				headers: {
					"cache-control": "no-store",
					"x-content-type-options": "nosniff",
					"content-type": download.type,
					"content-length": String(download.size),
					"content-disposition": contentDisposition(download.name),
				},
			});
		}),
	);

	// The public key of VAPID, which the app compares with the one its subscription was made with.
	app.get(
		NOTIFICATIONS_KEY_PATH,
		sessionRoute(async (verified) => Response.json({ key: notifications.key(verified) })),
	);

	// Subscribing the session's device to notices: who may, authorization decides; the body is the browser's
	// subscription, `{ endpoint, keys: { p256dh, auth } }`.
	app.put(
		SUBSCRIPTION_PATH,
		sessionRoute(async (verified, request) => {
			notifications.subscribe(verified, await request.json().catch(() => undefined));
			return Response.json({ subscribed: true });
		}),
	);

	// Unsubscribing: the device's subscription goes when it is of this session; 204 also when there was none.
	app.delete(
		SUBSCRIPTION_PATH,
		sessionRoute(async (verified) => {
			notifications.unsubscribe(verified);
			return new Response(null, { status: 204 });
		}),
	);

	// The live channel of this session (ADR 0029): an `EventSource` of the app, only with a session that lives.
	app.get(
		EVENTS_PATH,
		sessionRoute(async (verified, _request, c) => events.open(c, verified)),
	);

	/**
	 * The connected app whose key the request carries in `Authorization: Bearer`, `undefined` without the header. A
	 * bad key, of any form, a key next to the session cookie of Better Auth and a mandate without a key are refused
	 * with `UNAUTHORIZED`, never taken as no credential (ADR 0030).
	 */
	function appOf(request: Request): string | undefined {
		const read = readAuthorization(request.headers.get(AUTHORIZATION_HEADER));
		if (read.kind === "none") {
			if (!request.headers.has(MANDATE_HEADER)) return undefined;
			log("mandate refused: without-key");
			throw new ORPCError("UNAUTHORIZED");
		}
		/** The same answer to every failure; only the operator's log tells them apart. */
		const refuse = (reason: string): never => {
			log(`key refused: ${reason}`);
			throw new ORPCError("UNAUTHORIZED");
		};
		if (read.kind === "bad") return refuse(read.reason);
		if (getSessionCookie(request) !== null) return refuse("session-cookie");
		const check = checkKey(connection, appsOf(platform), read.key);
		if (!check.ok) return refuse(check.reason);
		noteKeyUse(connection, check.id, clockOf(platform)());
		return check.app;
	}

	/**
	 * The verified context of a request: from its session, where the account is the session's and asks itself (no
	 * via, the app channel, no conversation), or, only where `mandate` admits one, from its key and its mandate.
	 */
	async function contextOf(
		request: Request,
		responseHeaders: Headers,
		{ mandate = false }: { readonly mandate?: boolean } = {},
	): Promise<VerifiedContext | null> {
		// A key, good or bad, admits nothing that needs an account but with a mandate, not even next to a session
		// that lives; nor does a mandate, with its key or without.
		if (request.headers.has(AUTHORIZATION_HEADER) || request.headers.has(MANDATE_HEADER))
			return mandate ? mandateContextOf(request) : null;
		const session = await identity.sessionOf(request, responseHeaders);
		if (!session) return null;
		return sealContext({ ...originOf(session.id, session), channel: "app" });
	}

	/**
	 * The verified context a request's mandate keeps, for the app of its good key: the account, device, session,
	 * device account, identity and conversation of its origin, with `via` that app and the channel `contexto`. A bad
	 * key is refused as {@link appOf} refuses it; a missing, malformed or unresolved mandate is no context, which the
	 * caller answers `UNAUTHORIZED` as without a credential, and only the operator's log tells why.
	 */
	function mandateContextOf(request: Request): VerifiedContext | null {
		const app = appOf(request);
		if (app === undefined) return null;
		const read = readMandate(request.headers.get(MANDATE_HEADER));
		if (read.kind !== "mandate") {
			log(`mandate refused: ${read.kind === "none" ? "missing" : "malformed"}`);
			return null;
		}
		const resolution = resolveMandate(connection, read.id, app, clockOf(platform)());
		if (!resolution.ok) {
			log(`mandate refused: ${resolution.reason}`);
			return null;
		}
		return sealContext({ ...resolution.origin, via: app, channel: "contexto" });
	}

	return { fetch: async (request) => app.fetch(request) };
}

/**
 * The body of a download: `{ action, input, file }`, or `{ confirmation }` to confirm a pending one, else a bad
 * request.
 */
function downloadRequest(
	body: unknown,
):
	| { readonly action: string; readonly input: unknown; readonly file: string }
	| { readonly confirmation: string } {
	if (typeof body !== "object" || body === null || Array.isArray(body))
		throw new ORPCError("BAD_REQUEST");
	const { confirmation } = body as Record<string, unknown>;
	if (Object.keys(body).length === 1 && typeof confirmation === "string") return { confirmation };
	const { action, input, file, ...rest } = body as Record<string, unknown>;
	if (typeof action !== "string" || typeof file !== "string" || Object.keys(rest).length > 0)
		throw new ORPCError("BAD_REQUEST");
	return { action, input, file };
}

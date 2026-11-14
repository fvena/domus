import type { ModuleDefinition } from "@domus/module-sdk";
// Notices (ADR 0029): the subscriptions of the devices, the VAPID keys, and the job kinds of the notice and its
// delivery (./notices.ts), which the background runs. A subscription is not an action: it goes
// through a session route of its own, without the action log, undo or an idempotency key, because its endpoint is
// closer to a credential of the device than to data of the house. Its session and device come from the verified
// context, and whether the account may subscribe is decided in platform/authorization.
import { ORPCError } from "@orpc/server";
import type Database from "better-sqlite3";
import { z } from "zod";

import type { Clock, OutboxJob } from "../actions";
import { type AccessView, maySubscribe, type VerifiedContext } from "../authorization";
import type { JobKind } from "../background";
import type { Interleave } from "../files";
import { randomId } from "../identity/accounts";
import { sessionEnabledWhere, sessionLives } from "../identity/sessions";
import { endpointAllowed } from "./endpoint";
import { ensurePushKeys, vapidSubject } from "./keys";
import { noticeJobs } from "./notices";
import { recordFacts } from "./records";

export { endpointAllowed, PUSH_SERVICES } from "./endpoint";
export { vapidSubject } from "./keys";

/**
 * What the app sends to subscribe: the endpoint and keys of its browser's push subscription, as
 * `PushSubscription.toJSON()` gives them, and nothing else. Its `expirationTime`, a number or null, is accepted
 * and ignored: the push service drops an expired subscription, which then answers 404 or 410.
 */
const subscriptionBody = z.strictObject({
	endpoint: z.string().min(1),
	keys: z.strictObject({ p256dh: z.string().min(1), auth: z.string().min(1) }),
	expirationTime: z.number().nullable().optional(),
});

export interface Notifications {
	/** The public VAPID key, in base64url, for a session that lives; else `UNAUTHORIZED`. */
	key(context: VerifiedContext): string;
	/**
	 * Registers the subscription of the context's device from its session, replacing the one the device had: the
	 * same endpoint, session and keys change nothing; anything else deletes the earlier one and creates another with
	 * a new id. Throws the error of the spec's table: `FORBIDDEN`, `BAD_REQUEST` (with `push-endpoint-not-allowed`
	 * for an unknown service), `UNAUTHORIZED` for a session ended or expired, or `CONFLICT` with
	 * `session-not-enabled` for a session the device does not have enabled.
	 */
	subscribe(context: VerifiedContext, body: unknown): void;
	/** Deletes the subscription of the context's device when it is of this session; nothing when there is none. */
	unsubscribe(context: VerifiedContext): void;
	/**
	 * After a session is created on a device: deletes the device's subscription of another session. Only tidying:
	 * the earlier one stopped being enabled when the session entered.
	 */
	entered(session: string): void;
	/** The job kinds of the notice and its delivery, for the background to run. */
	readonly jobs: Readonly<Record<string, JobKind>>;
}

export interface NotificationsOptions {
	readonly connection: Database.Database;
	readonly clock: Clock;
	readonly view: AccessView;
	/** The hosts of the push services an endpoint may be of: production's unless a test composes its own. */
	readonly pushServices: readonly string[];
	/** The modules, whose owned records a notice may be about. */
	readonly modules: readonly ModuleDefinition[];
	/** The origins the app is served from: the first `https` one is the subject of VAPID. */
	readonly origins: readonly string[];
	/** How a delivery reaches the push service. */
	readonly fetch: typeof fetch;
	/** Leaves a delivery's job in the notice's transaction and returns its id: the background's outbox. */
	readonly enqueue: (job: OutboxJob) => number;
	readonly interleave?: Interleave;
}

/** Creates the VAPID keys when there are none, then serves the subscriptions. */
export function createNotifications({
	connection,
	clock,
	view,
	pushServices,
	modules,
	origins,
	fetch,
	enqueue,
	interleave,
}: NotificationsOptions): Notifications {
	const keys = ensurePushKeys(connection, clock());
	const { publicKey } = keys;
	const lives = sessionLives(connection);
	const enabled = connection.prepare<[string], { enabled: number }>(
		`SELECT ${sessionEnabledWhere("?")} AS enabled`,
	);
	const ofDevice = connection.prepare<
		[string],
		{ session: string; endpoint: string; p256dh: string; auth: string }
	>("SELECT session, endpoint, p256dh, auth FROM platform_push_subscriptions WHERE device = ?");
	const remove = connection.prepare<[string, string]>(
		"DELETE FROM platform_push_subscriptions WHERE device = ? OR endpoint = ?",
	);
	const insert = connection.prepare<[string, string, string, string, string, string, number]>(
		`INSERT INTO platform_push_subscriptions (id, device, session, endpoint, p256dh, auth, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)`,
	);
	const removeOfSession = connection.prepare<[string, string]>(
		"DELETE FROM platform_push_subscriptions WHERE device = ? AND session = ?",
	);
	// Only those of no enabled session: a sign-in on the device that wrote its entry later, and may have subscribed
	// before this one's creation ended, keeps its subscription.
	const removeOthers = connection.prepare<[{ session: string }]>(
		`DELETE FROM platform_push_subscriptions
		WHERE device = (SELECT device_id FROM platform_session WHERE id = @session) AND session <> @session
			AND NOT ${sessionEnabledWhere("platform_push_subscriptions.session")}`,
	);

	/** The session of a context that lives on the platform clock, else `UNAUTHORIZED`. */
	function living(context: VerifiedContext): string {
		const { account, session } = context;
		if (session === undefined || !lives(account, session, clock()))
			throw new ORPCError("UNAUTHORIZED");
		return session;
	}

	return {
		key: (context) => {
			living(context);
			return publicKey;
		},
		subscribe: (context, body) => {
			living(context);
			if (!maySubscribe(view, context)) throw new ORPCError("FORBIDDEN");
			const parsed = subscriptionBody.safeParse(body);
			if (!parsed.success) throw new ORPCError("BAD_REQUEST");
			const { endpoint, keys } = parsed.data;
			if (!endpointAllowed(endpoint, pushServices))
				throw new ORPCError("BAD_REQUEST", {
					data: { reason: "push-endpoint-not-allowed" },
				});
			// Checked again in the transaction that writes: an old session or a concurrent sign-in never replaces the
			// enabled one.
			connection.transaction(() => {
				const session = living(context);
				if (enabled.get(session)?.enabled !== 1)
					throw new ORPCError("CONFLICT", { data: { reason: "session-not-enabled" } });
				const current = ofDevice.get(context.device);
				if (
					current?.session === session &&
					current.endpoint === endpoint &&
					current.p256dh === keys.p256dh &&
					current.auth === keys.auth
				)
					return;
				remove.run(context.device, endpoint);
				insert.run(
					randomId(),
					context.device,
					session,
					endpoint,
					keys.p256dh,
					keys.auth,
					clock(),
				);
			})();
		},
		unsubscribe: (context) => {
			removeOfSession.run(context.device, living(context));
		},
		entered: (session) => {
			removeOthers.run({ session });
		},
		jobs: noticeJobs({
			connection,
			clock,
			view,
			records: recordFacts(connection, modules),
			keys,
			subject: vapidSubject(origins),
			pushServices,
			fetch,
			enqueue,
			...(interleave === undefined ? {} : { interleave }),
		}),
	};
}

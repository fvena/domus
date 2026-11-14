// The notice and its deliveries (ADR 0029, «Repartir y entregar»): two job kinds of the short lane. A notice, which
// a write leaves with `ctx.notify`, is shared out in one transaction into one delivery per enabled subscription of
// its recipient, never twice to the same one. Each delivery checks again, right before every attempt, that it may
// still go, and then sends the request that `web-push` encrypts and signs, through `fetch`, which the job's signal
// cancels. The content says only where the notice points to.
import type Database from "better-sqlite3";
import webPush from "web-push";
import { z } from "zod";

import { type Clock, NOTICE, type OutboxJob } from "../actions";
import type { AccessView } from "../authorization";
import { noticeDecision } from "../authorization/notices";
import { type JobKind, PermanentJobError } from "../background";
import type { Interleave } from "../files";
import { sessionEnabledWhere, sessionLivesWhere } from "../identity/sessions";
import { endpointAllowed } from "./endpoint";
import type { PushKeys } from "./keys";
import type { RecordFacts } from "./records";

export { NOTICE };

/** The kind of a delivery's job. */
export const DELIVERY = "delivery";

/** How long a notice may take to go out, from its creation: the TTL of its requests and its deliveries' deadline. */
export const NOTICE_LIFETIME = 24 * 60 * 60 * 1000;

/** The code of a delivery when the platform has no `https` origin to sign with: it does not send. */
export const PUSH_NOT_CONFIGURED = "PUSH_NOT_CONFIGURED";
/** The code of a delivery whose endpoint is no longer on a push service Domus admits. */
export const PUSH_ENDPOINT_NOT_ALLOWED = "PUSH_ENDPOINT_NOT_ALLOWED";
/** The code of a delivery whose subscription's keys cannot encrypt: the browser never gave them. */
export const PUSH_KEYS_INVALID = "PUSH_KEYS_INVALID";

/** The data of a notice: its recipient and the record it is about. Never text. */
const noticePayload = z.strictObject({
	to: z.string(),
	module: z.string(),
	type: z.string(),
	id: z.number().int(),
});
type NoticePayload = z.infer<typeof noticePayload>;

export interface NoticeJobsOptions {
	readonly connection: Database.Database;
	readonly clock: Clock;
	readonly view: AccessView;
	readonly records: RecordFacts;
	readonly keys: PushKeys;
	/** The subject of VAPID; unset, a delivery fails with {@link PUSH_NOT_CONFIGURED}. */
	readonly subject: string | undefined;
	/** The hosts of the push services an endpoint must still be of when it is sent to. */
	readonly pushServices: readonly string[];
	/** How a delivery reaches the push service. */
	readonly fetch: typeof fetch;
	/** Leaves a job in the caller's transaction, with an entry, and returns its id: the outbox of the background. */
	readonly enqueue: (job: OutboxJob) => number;
	readonly interleave?: Interleave;
}

/** The job kinds of the notices: the notice, which shares out, and the delivery, which sends. */
export function noticeJobs({
	connection,
	clock,
	view,
	records,
	keys,
	subject,
	pushServices,
	fetch,
	enqueue,
	interleave,
}: NoticeJobsOptions): Readonly<Record<string, JobKind>> {
	const selectNotice = connection.prepare<
		[number],
		{ entry: number | null; created_at: number; undone: number }
	>(
		`SELECT job.entry, job.created_at, coalesce(log.undone_by IS NOT NULL, 0) AS undone
		FROM platform_jobs job LEFT JOIN platform_action_log log ON log.entry = job.entry WHERE job.id = ?`,
	);
	// Every subscription of the account whose session lives now and is the one its device has enabled.
	const selectEnabled = connection.prepare<[{ account: string; now: number }], { id: string }>(
		`SELECT id FROM platform_push_subscriptions
		WHERE ${sessionLivesWhere("session", "@account", "@now")} AND ${sessionEnabledWhere("session")}
		ORDER BY created_at, id`,
	);
	const selectDelivered = connection.prepare<[number, string], { job: number }>(
		"SELECT job FROM platform_deliveries WHERE notice = ? AND subscription = ?",
	);
	const insertDelivery = connection.prepare<[number, number, string, number]>(
		"INSERT INTO platform_deliveries (job, notice, subscription, deadline) VALUES (?, ?, ?, ?)",
	);
	const selectDelivery = connection.prepare<
		[number],
		{ notice: number; subscription: string; payload: string }
	>(
		`SELECT delivery.notice, delivery.subscription, notice.payload FROM platform_deliveries delivery
		JOIN platform_jobs notice ON notice.id = delivery.notice WHERE delivery.job = ?`,
	);
	const selectSubscription = connection.prepare<
		[{ id: string; account: string; now: number }],
		{ endpoint: string; p256dh: string; auth: string; lives: number; enabled: number }
	>(
		`SELECT endpoint, p256dh, auth, ${sessionLivesWhere("session", "@account", "@now")} AS lives,
			${sessionEnabledWhere("session")} AS enabled
		FROM platform_push_subscriptions WHERE id = @id`,
	);

	/** Shares a notice out, in one transaction: its outcome, `distributed` once its deliveries exist. */
	const distribute = connection.transaction((id: number, notice: NoticePayload): string => {
		const found = selectNotice.get(id);
		// Only a write leaves a notice, so it always has its entry.
		if (!found || found.entry === null)
			throw new PermanentJobError(`the notice ${id} has no entry of its write`);
		if (found.undone === 1) return "undone";
		const decision = noticeDecision(view, notice.to, records(notice));
		if (decision !== "deliver") return decision;
		for (const { id: subscription } of selectEnabled.all({
			account: notice.to,
			now: clock(),
		})) {
			if (selectDelivered.get(id, subscription)) continue;
			// Its notice's entry, so the undo of the write cancels it too while it is pending.
			const job = enqueue({ kind: DELIVERY, payload: undefined, entry: found.entry });
			insertDelivery.run(job, id, subscription, found.created_at + NOTICE_LIFETIME);
		}
		return "distributed";
	});

	/**
	 * What a delivery sends, once every check passes: the request `web-push` encrypts and signs. Or the outcome of a
	 * delivery that may no longer go, which ends it without retries.
	 */
	function prepare(id: number): string | webPush.RequestDetails {
		const delivery = selectDelivery.get(id);
		if (!delivery) throw new PermanentJobError(`the delivery ${id} has no row`);
		const notice = noticePayload.parse(JSON.parse(delivery.payload));
		const subscription = selectSubscription.get({
			id: delivery.subscription,
			account: notice.to,
			now: clock(),
		});
		if (!subscription) return "subscription-gone";
		if (subscription.lives !== 1) return "session-ended";
		if (subscription.enabled !== 1) return "not-enabled";
		const decision = noticeDecision(view, notice.to, records(notice));
		if (decision !== "deliver") return decision;
		if (!endpointAllowed(subscription.endpoint, pushServices))
			throw new PermanentJobError("the endpoint is not of a push service Domus admits", {
				code: PUSH_ENDPOINT_NOT_ALLOWED,
			});
		if (subject === undefined)
			throw new PermanentJobError("no https origin to sign VAPID tokens with", {
				code: PUSH_NOT_CONFIGURED,
			});
		const content = {
			module: notice.module,
			type: notice.type,
			id: notice.id,
			notice: delivery.notice,
		};
		try {
			return webPush.generateRequestDetails(
				{
					endpoint: subscription.endpoint,
					keys: { p256dh: subscription.p256dh, auth: subscription.auth },
				},
				JSON.stringify(content),
				{
					vapidDetails: {
						subject,
						publicKey: keys.publicKey,
						privateKey: keys.privateKey,
					},
					TTL: NOTICE_LIFETIME / 1000,
					urgency: "normal",
					contentEncoding: "aes128gcm",
				},
			);
		} catch {
			throw new PermanentJobError("the subscription's keys cannot encrypt", {
				code: PUSH_KEYS_INVALID,
			});
		}
	}

	return {
		[NOTICE]: {
			lane: "short",
			payload: noticePayload,
			async run({ id, payload }) {
				await interleave?.("distributing");
				const outcome = distribute(id, payload as NoticePayload);
				await interleave?.("distributed");
				return outcome;
			},
		},
		[DELIVERY]: {
			lane: "short",
			async run({ id, signal }) {
				await interleave?.("delivering");
				// The checks and the start of the request in one synchronous section: nothing changes in between.
				const prepared = prepare(id);
				if (typeof prepared === "string") return prepared;
				const response = await fetch(prepared.endpoint, {
					method: prepared.method,
					headers: prepared.headers,
					// A copy on an ArrayBuffer of its own, as fetch types its body.
					body: prepared.body === null ? null : new Uint8Array(prepared.body),
					redirect: "manual",
					signal,
				});
				await response.body?.cancel();
				if (response.status >= 200 && response.status < 300) return "sent";
				throw new PushServiceError(response.status);
			},
		},
	};
}

/** An answer of the push service that is not a success: passing, retried by the engine. */
class PushServiceError extends Error {
	override readonly name = "PushServiceError";
	readonly code: string;

	constructor(status: number) {
		super(`the push service answered ${status}`);
		this.code = `HTTP_${status}`;
	}
}

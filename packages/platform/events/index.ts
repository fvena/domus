import { ORPCError } from "@orpc/server";
// The live channel (ADR 0029): `GET /api/events`, one stream per tab of a session, over which only invalidations
// travel: which records changed, never their content. A write remembers its changed records in a temporary table
// of its own transaction, so a rollback, of the whole write or of a savepoint, takes them away with it; once no
// transaction is open, what committed is read in order and shared out in memory to each open channel whose
// account `platform/authorization` says sees it. Each channel gets one `invalidate` per write that reaches it, in
// the order of the commits. Its queue holds at most a limit of events not yet written: past it the channel is cut,
// without `purge`, and the browser reconnects and asks again for what it shows. A heartbeat every 25 s of the
// platform clock and timer checks that the session lives, and when not writes `purge` and closes. A session has at
// most 6 channels: opening another cuts the oldest. One process of `api` only: the channels live in its memory.
import type Database from "better-sqlite3";
import type { Context } from "hono";
import { type SSEStreamingApi, streamSSE } from "hono/streaming";

import type { Clock } from "../actions";
import type { AccessView, VerifiedContext } from "../authorization";
import { invalidationReaches, type RecordChange } from "../authorization/invalidations";
import type { Timer } from "../background/timer";
import type { SessionLives } from "../identity/sessions";

/** How often a channel writes its heartbeat and checks its session, in milliseconds of the platform clock. */
export const HEARTBEAT_INTERVAL = 25 * 1000;

/** The most channels one session keeps open. */
export const CHANNELS_PER_SESSION = 6;

/** The most events a channel holds unwritten unless the test lowers it. */
export const DEFAULT_QUEUE_LIMIT = 100;

/** The table where a write leaves its changed records, inside its own transaction. */
const PENDING = "platform_invalidations";

export interface EventsOptions {
	readonly connection: Database.Database;
	readonly view: AccessView;
	readonly clock: Clock;
	readonly timer: Timer;
	readonly sessionLives: SessionLives;
	/** The most events a channel holds unwritten: {@link DEFAULT_QUEUE_LIMIT} unless a test lowers it. */
	readonly queueLimit?: number;
}

export interface Events {
	/**
	 * Remembers the records a write changed, inside its transaction: they are shared out once it commits, and never
	 * if it rolls back.
	 */
	remember(changes: readonly RecordChange[]): void;
	/** Opens a channel for a verified context with a session: `ready` once it is registered, then its events. */
	open(c: Context, context: VerifiedContext): Response;
	/** Cuts every channel, without `purge`: the platform is closing. */
	close(): void;
}

/** What a channel writes: one of its events, or a comment such as the heartbeat. */
type Outgoing =
	| { readonly event: "ready" | "invalidate" | "purge"; readonly data: object }
	| { readonly comment: string };

interface Channel {
	readonly account: string;
	readonly session: string;
	/** What it has not written yet, in order. */
	readonly queue: Outgoing[];
	/** `ending` writes what it holds and closes; `cut` drops it and stops at once. */
	state: "open" | "ending" | "cut";
	/** Wakes its writing loop when something arrives or it ends. */
	wake: () => void;
	cancelBeat: () => void;
	stream?: SSEStreamingApi;
}

interface PendingRow {
	readonly seq: number;
	readonly changes: string;
}

export function createEvents({
	connection,
	view,
	clock,
	timer,
	sessionLives,
	queueLimit = DEFAULT_QUEUE_LIMIT,
}: EventsOptions): Events {
	if (!Number.isSafeInteger(queueLimit) || queueLimit < 1)
		throw new Error(
			`the queue limit must be a positive whole number, got ${String(queueLimit)}`,
		);
	connection.exec(
		`CREATE TEMP TABLE ${PENDING} (seq INTEGER PRIMARY KEY, changes TEXT NOT NULL)`,
	);
	const insert = connection.prepare<[string]>(`INSERT INTO temp.${PENDING} (changes) VALUES (?)`);
	const pending = connection.prepare<[], PendingRow>(
		`SELECT seq, changes FROM temp.${PENDING} ORDER BY seq`,
	);
	const taken = connection.prepare<[number]>(`DELETE FROM temp.${PENDING} WHERE seq <= ?`);

	/** The open channels, oldest first. */
	const channels: Channel[] = [];
	let scheduled = false;

	/**
	 * Shares out what committed, in order. Only with no transaction open: one still open may hold rows that are not
	 * committed yet, and its end schedules another pass.
	 */
	function share(): void {
		scheduled = false;
		if (connection.inTransaction || !connection.open) return;
		const rows = pending.all();
		const last = rows[rows.length - 1];
		if (last === undefined) return;
		taken.run(last.seq);
		const listening = [...channels].filter((channel) => {
			if (sessionLives(channel.account, channel.session, clock())) return true;
			end(channel);
			return false;
		});
		for (const row of rows) {
			const changes = JSON.parse(row.changes) as RecordChange[];
			for (const channel of listening) {
				if (channel.state !== "open") continue;
				const reached = changes
					.filter((change) => invalidationReaches(view, channel.account, change))
					.map(({ module, type, id }) => ({ module, type, id }));
				if (reached.length > 0)
					enqueue(channel, { event: "invalidate", data: { records: reached } });
			}
		}
	}

	/** Queues one item on an open channel, or cuts it when its queue is already full. */
	function enqueue(channel: Channel, item: Outgoing): void {
		if (channel.queue.length >= queueLimit) {
			cut(channel);
			return;
		}
		channel.queue.push(item);
		channel.wake();
	}

	function unregister(channel: Channel): void {
		const at = channels.indexOf(channel);
		if (at !== -1) channels.splice(at, 1);
		channel.cancelBeat();
	}

	/** The session ended: `purge` after what it holds, then the stream closes. */
	function end(channel: Channel): void {
		if (channel.state !== "open") return;
		unregister(channel);
		channel.queue.push({ event: "purge", data: {} });
		channel.state = "ending";
		channel.wake();
	}

	/** Stops a channel at once, dropping what it holds: the browser reconnects and asks again. */
	function cut(channel: Channel): void {
		if (channel.state === "cut") return;
		unregister(channel);
		channel.queue.length = 0;
		channel.state = "cut";
		channel.stream?.abort();
		channel.wake();
	}

	function arm(channel: Channel): void {
		channel.cancelBeat = timer.at(clock() + HEARTBEAT_INTERVAL, () => {
			if (channel.state !== "open") return;
			// What committed before this beat goes before it.
			share();
			if (channel.state !== "open") return;
			if (!sessionLives(channel.account, channel.session, clock())) {
				end(channel);
				return;
			}
			enqueue(channel, { comment: "heartbeat" });
			if (channel.state === "open") arm(channel);
		});
	}

	return {
		remember(changes) {
			if (changes.length === 0) return;
			insert.run(JSON.stringify(changes));
			if (!scheduled) {
				scheduled = true;
				// A transaction of better-sqlite3 ends before any microtask runs.
				queueMicrotask(share);
			}
		},
		open(c, { account, session }) {
			if (session === undefined || !sessionLives(account, session, clock()))
				throw new ORPCError("UNAUTHORIZED");
			// What committed before this channel goes to those open before it.
			share();
			const channel: Channel = {
				account,
				session,
				queue: [{ event: "ready", data: {} }],
				state: "open",
				wake: () => {},
				cancelBeat: () => {},
			};
			const own = channels.filter((open) => open.session === session);
			if (own.length >= CHANNELS_PER_SESSION && own[0]) cut(own[0]);
			channels.push(channel);
			arm(channel);
			return streamSSE(c, async (stream) => {
				channel.stream = stream;
				// The browser went away: its tab closed or its connection dropped.
				stream.onAbort(() => cut(channel));
				for (;;) {
					const next = channel.queue.shift();
					if (next !== undefined) {
						await ("comment" in next
							? stream.write(`: ${next.comment}\n\n`)
							: stream.writeSSE({
									event: next.event,
									data: JSON.stringify(next.data),
								}));
						continue;
					}
					if (channel.state !== "open") return;
					await new Promise<void>((resolve) => {
						channel.wake = resolve;
					});
					channel.wake = () => {};
				}
			});
		},
		close() {
			for (const channel of channels.splice(0)) cut(channel);
		},
	};
}

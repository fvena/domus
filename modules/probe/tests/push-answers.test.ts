// What a delivery does with each answer of the push service (ADR 0029, spec of phase 1d4, «La entrega y el envío»):
// a failing device does not hold back the others, a retry never sends again what already arrived, Domus waits at
// least what the service asks, gives up past the notice's deadline, and a request that never ends frees the short
// lane at its maximum time.
import {
	createTestPlatform,
	fakePushService,
	type FakePushService,
	neverAnswers,
	type PushAnswer,
	pushClient,
	type PushClient,
	TEST_ORIGIN,
	type TestBrowser,
	type TestPlatform,
	type VerifiedContext,
} from "@domus/test-utils";
import { describe, expect, it } from "vitest";

import probe from "../server";

type Probe = TestPlatform<readonly [typeof probe]>;

const PASSWORD = "correct horse battery staple";
const SECOND = 1000;
/** The engine's wait before a first retry. */
const FIRST_RETRY = 30 * SECOND;
/** The short lane's maximum time. */
const SHORT_LANE_TIMEOUT = 30 * SECOND;
/** A notice's deadline, from its creation. */
const NOTICE_LIFETIME = 24 * 60 * 60 * SECOND;

/** A platform with probe and a fake push service, where Paco and Rocío, members, have a password. */
async function household({ started = true }: { readonly started?: boolean } = {}) {
	const push = fakePushService();
	const test = createTestPlatform({ modules: [probe], push });
	for (const id of ["paco", "rocio"]) {
		test.prepare.account({ id, role: "member" });
		await test.prepare.password(id, PASSWORD);
	}
	if (started) test.background.start();
	return { test, push, rocio: test.context("rocio") };
}

/** Paco signed in on a new device, subscribed with a client of the fake service named `name`. */
async function pacoDevice(test: Probe, name: string): Promise<PushClient> {
	const browser: TestBrowser = test.browser();
	expect((await browser.signIn("paco@domus.test", PASSWORD)).status).toBe(200);
	const client = pushClient(name);
	const response = await browser.fetch(
		new Request(new URL("/api/notifications/subscription", TEST_ORIGIN), {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ endpoint: client.endpoint, keys: client.keys }),
		}),
	);
	expect(response.status).toBe(200);
	return client;
}

/** Rocío's public note, with a notice to Paco about it. */
function noticeToPaco(test: Probe, rocio: VerifiedContext): void {
	const added = test.invoke(
		rocio,
		"probe.addNote",
		{ body: "comprar pan" },
		{ idempotencyKey: "add" },
	);
	if (!("result" in added)) throw new Error("expected the write's result");
	const { id } = added.result;
	test.invoke(
		rocio,
		"probe.setNoteVisibility",
		{ id, visibility: "public" },
		{ idempotencyKey: "publish" },
	);
	test.invoke(
		rocio,
		"probe.editNote",
		{ id, body: "comprar pan y leche", notify: ["paco"] },
		{ idempotencyKey: "edit" },
	);
}

/** Each delivery as data. */
function deliveries(test: Probe) {
	return test.background
		.jobs()
		.filter((job) => job.kind === "delivery")
		.map(({ state, attempts, runAt, outcome, error }) => ({
			state,
			attempts,
			runAt,
			outcome,
			error,
		}));
}

/** How many requests reached `client`. */
function reachedTimes(push: FakePushService, client: PushClient): number {
	return push.requests.filter(({ url }) => url === client.endpoint).length;
}

const status =
	(code: number, headers: Record<string, string> = {}): PushAnswer =>
	() =>
		new Response(null, { status: code, headers });

describe("a delivery the push service answers", () => {
	it.each([404, 410])("%i forgets the subscription and ends subscription-gone", async (code) => {
		const { test, push, rocio } = await household();
		await using _ = test;
		await pacoDevice(test, "paco-phone");

		push.answer(status(code));
		noticeToPaco(test, rocio);
		await test.background.runDue();

		expect(deliveries(test)).toEqual([
			expect.objectContaining({
				state: "done",
				outcome: "subscription-gone",
				error: null,
			}),
		]);
		expect(test.subscriptions()).toEqual([]);
	});

	it.each([400, 413])("%i fails for good with PUSH_REJECTED, without retries", async (code) => {
		const { test, push, rocio } = await household();
		await using _ = test;
		const phone = await pacoDevice(test, "paco-phone");

		push.answer(status(code));
		noticeToPaco(test, rocio);
		await test.background.runDue();
		test.clock.advance(60 * 60 * SECOND);
		await test.background.settled();

		expect(deliveries(test)).toEqual([
			expect.objectContaining({
				state: "failed",
				attempts: 1,
				error: `PermanentJobError PUSH_REJECTED: the push service answered ${code}`,
			}),
		]);
		expect(reachedTimes(push, phone)).toBe(1);
	});

	it.each([401, 403])(
		"%i fails for good with PUSH_UNAUTHORIZED, and the subscription stays",
		async (code) => {
			const { test, push, rocio } = await household();
			await using _ = test;
			await pacoDevice(test, "paco-phone");

			push.answer(status(code));
			noticeToPaco(test, rocio);
			await test.background.runDue();

			expect(deliveries(test)).toEqual([
				expect.objectContaining({
					state: "failed",
					attempts: 1,
					error: expect.stringMatching(/^PermanentJobError PUSH_UNAUTHORIZED: /),
				}),
			]);
			expect(test.subscriptions()).toHaveLength(1);
		},
	);

	it.each([301, 302, 307, 308])(
		"%i fails for good with PUSH_REDIRECT, without following it",
		async (code) => {
			const { test, push, rocio } = await household();
			await using _ = test;
			const phone = await pacoDevice(test, "paco-phone");
			const elsewhere = pushClient("elsewhere");

			push.answer(status(code, { location: elsewhere.endpoint }));
			noticeToPaco(test, rocio);
			await test.background.runDue();

			expect(deliveries(test)).toEqual([
				expect.objectContaining({
					state: "failed",
					attempts: 1,
					error: expect.stringMatching(/^PermanentJobError PUSH_REDIRECT: /),
				}),
			]);
			expect(push.requests.map(({ url, redirect }) => ({ url, redirect }))).toEqual([
				{ url: phone.endpoint, redirect: "manual" },
			]);
		},
	);

	it.each<[string, PushAnswer, string]>([
		["429", status(429), "PassingJobError HTTP_429"],
		["500", status(500), "PassingJobError HTTP_500"],
		["502", status(502), "PassingJobError HTTP_502"],
		["503", status(503), "PassingJobError HTTP_503"],
		["a network error", () => Promise.reject(new TypeError("fetch failed")), "TypeError"],
	])("%s is retried after the growing wait, and then sent", async (_, failing, error) => {
		const { test, push, rocio } = await household();
		await using _platform = test;
		const phone = await pacoDevice(test, "paco-phone");

		push.answer(failing);
		noticeToPaco(test, rocio);
		await test.background.runDue();
		const failedAt = test.clock.now();
		expect(deliveries(test)).toEqual([
			expect.objectContaining({ state: "pending", runAt: failedAt + FIRST_RETRY, error }),
		]);

		test.clock.advance(FIRST_RETRY - 1);
		await test.background.settled();
		expect(reachedTimes(push, phone)).toBe(1);
		test.clock.advance(1);
		await test.background.settled();
		expect(reachedTimes(push, phone)).toBe(2);

		// A second failure waits twice as long.
		test.clock.advance(2 * FIRST_RETRY - 1);
		await test.background.settled();
		expect(reachedTimes(push, phone)).toBe(2);
		push.answer(status(201));
		test.clock.advance(1);
		await test.background.settled();

		expect(reachedTimes(push, phone)).toBe(3);
		expect(deliveries(test)).toEqual([
			expect.objectContaining({ state: "done", attempts: 3, outcome: "sent" }),
		]);
	});
});

describe("a delivery the push service asks to wait with Retry-After", () => {
	it.each<[string, number, (now: number) => string]>([
		["seconds", 429, () => "120"],
		["seconds", 503, () => "120"],
		["an HTTP date", 429, (now) => new Date(now + 120 * SECOND).toUTCString()],
		["an HTTP date", 503, (now) => new Date(now + 120 * SECOND).toUTCString()],
	])("in %s on %i is not retried before it", async (_, code, retryAfter) => {
		const { test, push, rocio } = await household();
		await using _platform = test;
		const phone = await pacoDevice(test, "paco-phone");

		const askedAt = test.clock.now();
		push.answer(status(code, { "retry-after": retryAfter(askedAt) }));
		noticeToPaco(test, rocio);
		await test.background.runDue();
		expect(deliveries(test)).toEqual([
			expect.objectContaining({ state: "pending", runAt: askedAt + 120 * SECOND }),
		]);

		push.answer(status(201));
		test.clock.advance(120 * SECOND - 1);
		await test.background.settled();
		expect(reachedTimes(push, phone)).toBe(1);
		test.clock.advance(1);
		await test.background.settled();

		expect(reachedTimes(push, phone)).toBe(2);
		expect(deliveries(test)).toEqual([
			expect.objectContaining({ state: "done", outcome: "sent" }),
		]);
	});

	it("keeps the growing wait when the value is invalid", async () => {
		const { test, push, rocio } = await household();
		await using _ = test;
		await pacoDevice(test, "paco-phone");

		push.answer(status(503, { "retry-after": "in a while" }));
		noticeToPaco(test, rocio);
		await test.background.runDue();

		expect(deliveries(test)).toEqual([
			expect.objectContaining({
				state: "pending",
				runAt: test.clock.now() + FIRST_RETRY,
			}),
		]);
	});

	it.each<[string, (now: number) => string]>([
		["seconds", () => String(25 * 60 * 60)],
		["an HTTP date", (now) => new Date(now + 25 * 60 * 60 * SECOND).toUTCString()],
	])(
		"in %s past the deadline of 24 h fails for good with DELIVERY_EXPIRED, without trying before",
		async (_, retryAfter) => {
			const { test, push, rocio } = await household();
			await using _platform = test;
			const phone = await pacoDevice(test, "paco-phone");

			push.answer(status(503, { "retry-after": retryAfter(test.clock.now()) }));
			noticeToPaco(test, rocio);
			await test.background.runDue();
			test.clock.advance(NOTICE_LIFETIME + 60 * 60 * SECOND);
			await test.background.settled();

			expect(deliveries(test)).toEqual([
				expect.objectContaining({
					state: "failed",
					attempts: 1,
					error: expect.stringMatching(/^PermanentJobError DELIVERY_EXPIRED: /),
				}),
			]);
			expect(reachedTimes(push, phone)).toBe(1);
		},
	);
});

describe("a delivery near its deadline", () => {
	it("whose growing wait would go past it fails for good with DELIVERY_EXPIRED at once", async () => {
		const { test, push, rocio } = await household({ started: false });
		await using _ = test;
		const phone = await pacoDevice(test, "paco-phone");

		noticeToPaco(test, rocio);
		test.clock.advance(NOTICE_LIFETIME - FIRST_RETRY + 1, { wake: false });
		push.answer(status(500));
		test.background.start();
		await test.background.runDue();

		expect(deliveries(test)).toEqual([
			expect.objectContaining({
				state: "failed",
				attempts: 1,
				error: expect.stringMatching(/^PermanentJobError DELIVERY_EXPIRED: /),
			}),
		]);
		expect(reachedTimes(push, phone)).toBe(1);
	});

	it("that first runs past it fails for good with DELIVERY_EXPIRED, and sends nothing", async () => {
		const { test, push, rocio } = await household({ started: false });
		await using _ = test;
		await pacoDevice(test, "paco-phone");

		noticeToPaco(test, rocio);
		test.clock.advance(NOTICE_LIFETIME + 1, { wake: false });
		test.background.start();
		await test.background.runDue();

		expect(deliveries(test)).toEqual([
			expect.objectContaining({
				state: "failed",
				error: expect.stringMatching(/^PermanentJobError DELIVERY_EXPIRED: /),
			}),
		]);
		expect(push.requests).toEqual([]);
	});
});

/** Turns the macrotask queue until `done` holds, at most a hundred times. */
async function until(test: Probe, done: () => boolean): Promise<void> {
	for (let turn = 0; turn < 100 && !done(); turn++) await test.background.flush();
	if (!done()) throw new Error("the condition never held");
}

describe("a request to the push service that never ends", () => {
	it("is cancelled at the short lane's maximum time, ends, and frees the lane for the next delivery", async () => {
		const { test, push, rocio } = await household();
		await using _ = test;
		const phone = await pacoDevice(test, "paco-phone");
		const laptop = await pacoDevice(test, "paco-laptop");

		let first = true;
		push.answer((request) => {
			if (!first) return new Response(null, { status: 201 });
			first = false;
			return neverAnswers(request);
		});
		noticeToPaco(test, rocio);
		await until(test, () => push.requests.length === 1);
		const [hanging] = push.requests;
		const [stuck, other] = hanging?.url === phone.endpoint ? [phone, laptop] : [laptop, phone];

		test.clock.advance(SHORT_LANE_TIMEOUT - 1);
		await test.background.flush();
		expect(hanging?.signal?.aborted).toBe(false);
		expect(push.requests).toHaveLength(1);
		test.clock.advance(1);
		expect(hanging?.signal?.aborted).toBe(true);
		await test.background.settled();

		expect(reachedTimes(push, other)).toBe(1);
		expect(deliveries(test)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					state: "pending",
					attempts: 1,
					error: `timed out after ${SHORT_LANE_TIMEOUT} ms`,
				}),
				expect.objectContaining({ state: "done", outcome: "sent" }),
			]),
		);

		test.clock.advance(FIRST_RETRY);
		await test.background.settled();
		expect(deliveries(test)).toEqual([
			expect.objectContaining({ state: "done", outcome: "sent" }),
			expect.objectContaining({ state: "done", outcome: "sent" }),
		]);
		expect([reachedTimes(push, stuck), reachedTimes(push, other)]).toEqual([2, 1]);
	});
});

describe("a notice to two devices, one failing", () => {
	it("reaches the one that answers once, and the retry of the other does not repeat it", async () => {
		const { test, push, rocio } = await household();
		await using _ = test;
		const phone = await pacoDevice(test, "paco-phone");
		const laptop = await pacoDevice(test, "paco-laptop");

		push.answer(
			(request) => new Response(null, { status: request.url === phone.endpoint ? 500 : 201 }),
		);
		noticeToPaco(test, rocio);
		await test.background.runDue();
		expect([reachedTimes(push, phone), reachedTimes(push, laptop)]).toEqual([1, 1]);

		push.answer(status(201));
		test.clock.advance(FIRST_RETRY);
		await test.background.settled();

		expect([reachedTimes(push, phone), reachedTimes(push, laptop)]).toEqual([2, 1]);
		expect(deliveries(test)).toEqual([
			expect.objectContaining({ state: "done", outcome: "sent" }),
			expect.objectContaining({ state: "done", outcome: "sent" }),
		]);
	});
});

// Notices (ADR 0029, spec of phase 1d4, «ctx.notify», «El aviso y su reparto» and «La entrega y el envío»): a write
// leaves a notice to a person about one of its records; the notice is shared out into one delivery per enabled
// subscription of that person, and each delivery checks again, right before sending, that it may still go. What
// reaches the fake push service is encrypted for the subscription's keys, signed with the platform's VAPID key and
// carries only where it points to.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	createTestPlatform,
	fakePushService,
	type FakePushService,
	type InterleavePoint,
	pushClient,
	type PushClient,
	startChild,
	TEST_ORIGIN,
	TEST_START,
	type TestBrowser,
	type TestPlatform,
	vapidClaims,
	type VerifiedContext,
} from "@domus/test-utils";
import { afterEach, describe, expect, it, type MockInstance, vi } from "vitest";

import probe from "../server";

type Probe = TestPlatform<readonly [typeof probe]>;

const PASSWORD = "correct horse battery staple";
/** The engine's wait before a first retry. */
const FIRST_RETRY = 30 * 1000;

/**
 * A platform with probe and a fake push service, where Paco and Rocío, members, have a password; its background
 * started unless `started` is false.
 */
async function household({
	started = true,
	...options
}: {
	readonly interleave?: (point: InterleavePoint) => Promise<void> | void;
	readonly origins?: readonly string[];
	readonly file?: string;
	readonly started?: boolean;
} = {}) {
	const push = fakePushService();
	const test = createTestPlatform({ modules: [probe], push, ...options });
	for (const id of ["paco", "rocio"]) {
		test.prepare.account({ id, role: "member" });
		await test.prepare.password(id, PASSWORD);
	}
	if (started) test.background.start();
	return { test, push, paco: test.context("paco"), rocio: test.context("rocio") };
}

async function signedIn(test: Probe, who: string): Promise<TestBrowser> {
	const browser = test.browser();
	expect((await browser.signIn(`${who}@domus.test`, PASSWORD)).status).toBe(200);
	return browser;
}

/** Subscribes the browser's device with a client of the fake service, through the door, as the app will. */
async function subscribed(browser: TestBrowser, name: string): Promise<PushClient> {
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

/** The public VAPID key the door serves. */
async function publicKey(browser: TestBrowser): Promise<string> {
	const response = await browser.fetch(
		new Request(new URL("/api/notifications/key", TEST_ORIGIN)),
	);
	return ((await response.json()) as { key: string }).key;
}

/** Each job of a kind as data: its state and outcome. */
function jobsOf(test: Probe, kind: string) {
	return test.background
		.jobs()
		.filter((job) => job.kind === kind)
		.map(({ id, state, outcome, error }) => ({ id, state, outcome, error }));
}

/** The endpoints the fake service received a request for, in order. */
function reached(push: FakePushService): readonly string[] {
	return push.requests.map((request) => request.url);
}

describe("a notice about a note", () => {
	it("reaches every enabled subscription of its recipient and no other, encrypted, signed and with only its destination", async () => {
		const { test, push, rocio } = await household();
		await using _ = test;
		const phone = await signedIn(test, "paco");
		const laptop = await signedIn(test, "paco");
		const pacoPhone = await subscribed(phone, "paco-phone");
		const pacoLaptop = await subscribed(laptop, "paco-laptop");
		await subscribed(await signedIn(test, "rocio"), "rocio-phone");

		const added = test.invoke(
			rocio,
			"probe.addNote",
			{ body: "comprar pan", notify: ["paco"] },
			{ idempotencyKey: "add" },
		);
		if (!("result" in added)) throw new Error("expected the write's result");
		test.invoke(
			rocio,
			"probe.setNoteVisibility",
			{ id: added.result.id, visibility: "public" },
			{ idempotencyKey: "publish" },
		);
		await test.background.runDue();

		expect([...reached(push)].sort()).toEqual([pacoLaptop.endpoint, pacoPhone.endpoint].sort());
		const [notice] = jobsOf(test, "notice");
		expect(notice).toEqual({
			id: expect.any(Number),
			state: "done",
			outcome: "distributed",
			error: null,
		});
		expect(jobsOf(test, "delivery")).toEqual([
			expect.objectContaining({ state: "done", outcome: "sent" }),
			expect.objectContaining({ state: "done", outcome: "sent" }),
		]);

		const key = await publicKey(phone);
		for (const client of [pacoPhone, pacoLaptop]) {
			const request = push.requests.find(({ url }) => url === client.endpoint);
			if (!request) throw new Error(`nothing reached ${client.endpoint}`);
			expect(request.method).toBe("POST");
			expect(request.redirect).toBe("manual");
			expect(request.signal).toBeInstanceOf(AbortSignal);
			expect(request.headers).toMatchObject({
				ttl: "86400",
				urgency: "normal",
				"content-encoding": "aes128gcm",
			});
			expect(client.read(request)).toEqual({
				module: "probe",
				type: "note",
				id: added.result.id,
				notice: notice?.id,
			});
			expect(vapidClaims(request, key)).toEqual({
				aud: "https://push.domus.test",
				sub: "https://domus.test",
				exp: expect.any(Number),
			});
		}
	});
});

/**
 * Rocío's public note, and then an edit of it that notifies `to`, the last write on it, so it can be undone. Returns
 * the note's id and the entry of the edit.
 */
function publicNote(test: Probe, rocio: VerifiedContext, to: readonly string[]) {
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
	const edited = test.invoke(
		rocio,
		"probe.editNote",
		{ id, body: "comprar pan y leche", notify: [...to] },
		{ idempotencyKey: "edit" },
	);
	if (!("result" in edited)) throw new Error("expected the write's result");
	return { id, entry: edited.entry };
}

describe("a notice that does not go", () => {
	it.each([
		["the device account", (test: Probe) => test.deviceAccount],
		["an account that does not exist", () => "nobody"],
	])("to %s ends not-member, without deliveries", async (_, recipient) => {
		const { test, push, rocio } = await household();
		await using _platform = test;
		await subscribed(await signedIn(test, "paco"), "paco-phone");

		publicNote(test, rocio, [recipient(test)]);
		await test.background.runDue();

		expect(jobsOf(test, "notice")).toEqual([
			expect.objectContaining({ state: "done", outcome: "not-member" }),
		]);
		expect(jobsOf(test, "delivery")).toEqual([]);
		expect(push.requests).toEqual([]);
	});

	it("about a note deleted before it is shared out ends record-gone, without deliveries", async () => {
		const { test, push, rocio } = await household();
		await using _ = test;
		await subscribed(await signedIn(test, "paco"), "paco-phone");

		const note = publicNote(test, rocio, ["paco"]);
		test.invoke(rocio, "probe.deleteNote", { id: note.id }, { idempotencyKey: "delete" });
		await test.background.runDue();

		expect(jobsOf(test, "notice")).toEqual([
			expect.objectContaining({ state: "done", outcome: "record-gone" }),
		]);
		expect(jobsOf(test, "delivery")).toEqual([]);
		expect(push.requests).toEqual([]);
	});

	it("about a private note of another person ends not-visible, without deliveries", async () => {
		const { test, push, rocio } = await household();
		await using _ = test;
		await subscribed(await signedIn(test, "paco"), "paco-phone");

		test.invoke(
			rocio,
			"probe.addNote",
			{ body: "regalo para Paco", notify: ["paco"] },
			{ idempotencyKey: "add" },
		);
		await test.background.runDue();

		expect(jobsOf(test, "notice")).toEqual([
			expect.objectContaining({ state: "done", outcome: "not-visible" }),
		]);
		expect(jobsOf(test, "delivery")).toEqual([]);
		expect(push.requests).toEqual([]);
	});

	it("to a person who lost read in the note's area ends not-visible, without deliveries", async () => {
		const { test, push, rocio } = await household();
		await using _ = test;
		await subscribed(await signedIn(test, "paco"), "paco-phone");

		publicNote(test, rocio, ["paco"]);
		test.prepare.grant("paco", "probe", "none");
		await test.background.runDue();

		expect(jobsOf(test, "notice")).toEqual([
			expect.objectContaining({ state: "done", outcome: "not-visible" }),
		]);
		expect(jobsOf(test, "delivery")).toEqual([]);
		expect(push.requests).toEqual([]);
	});

	it("to a person without any subscription ends distributed, without deliveries", async () => {
		const { test, push, rocio } = await household();
		await using _ = test;

		publicNote(test, rocio, ["paco"]);
		await test.background.runDue();

		expect(jobsOf(test, "notice")).toEqual([
			expect.objectContaining({ state: "done", outcome: "distributed" }),
		]);
		expect(push.requests).toEqual([]);
	});
});

const spies: MockInstance[] = [];
afterEach(() => {
	for (const spy of spies.splice(0)) spy.mockRestore();
});

/**
 * Makes `action` also leave a notice to Paco about `about` from its handler, before the platform registers it: the
 * mistake a module could make.
 */
function alsoNotifies(action: "addNote" | "countNotes", about: { type: string; id: unknown }) {
	const actions = probe.actions as Record<string, (context: never) => unknown>;
	const original = actions[action];
	if (!original) throw new Error(`probe has no ${action}`);
	spies.push(
		vi
			.spyOn(actions, action)
			.mockImplementation((context: { notify: (notice: unknown) => void }) => {
				const outcome = original(context as never);
				context.notify({ to: "paco", about });
				return outcome;
			}),
	);
}

describe("a stored notice about a type that no owned or area table declares", () => {
	it("fails for good with UNKNOWN_RECORD, without deliveries, as one of a module that is gone would", async () => {
		const actions = probe.actions as Record<string, (context: never) => unknown>;
		const original = actions.addNote;
		if (!original) throw new Error("probe has no addNote");
		let platform: Probe | undefined;
		// Left as the outbox keeps it, past the check of `ctx.notify`.
		spies.push(
			vi.spyOn(actions, "addNote").mockImplementation((context) => {
				const outcome = original(context);
				platform?.background.enqueueInWrite("notice", {
					to: "paco",
					module: "probe",
					type: "shopping",
					id: 1,
				});
				return outcome;
			}),
		);
		const { test, push, rocio } = await household();
		platform = test;
		await using _ = test;
		await subscribed(await signedIn(test, "paco"), "paco-phone");

		test.invoke(rocio, "probe.addNote", { body: "pan" }, { idempotencyKey: "add" });
		await test.background.runDue();

		expect(jobsOf(test, "notice")).toEqual([
			expect.objectContaining({
				state: "failed",
				error: expect.stringMatching(/^PermanentJobError UNKNOWN_RECORD: /),
			}),
		]);
		expect(jobsOf(test, "delivery")).toEqual([]);
		expect(push.requests).toEqual([]);
	});
});

describe("leaving a notice", () => {
	it("about a type that no owned or area table of the module has rolls the write back as internal", async () => {
		alsoNotifies("addNote", { type: "shopping", id: 1 });
		const { test, rocio } = await household();
		await using _ = test;

		expect(() =>
			test.invoke(rocio, "probe.addNote", { body: "pan" }, { idempotencyKey: "add" }),
		).toThrow(expect.objectContaining({ code: "INTERNAL_SERVER_ERROR" }));
		expect(test.invoke(rocio, "probe.countNotes")).toBe(0);
		expect(test.log()).toEqual([]);
		expect(test.background.jobs()).toEqual([]);
	});

	it.each([
		["the text", "1"],
		["a fraction", 1.5],
	])(
		"about a record by an id that is not an integer, %s, rolls the write back as internal",
		async (_name, id) => {
			alsoNotifies("addNote", { type: "note", id });
			const { test, rocio } = await household();
			await using _ = test;

			expect(() =>
				test.invoke(rocio, "probe.addNote", { body: "pan" }, { idempotencyKey: "add" }),
			).toThrow(expect.objectContaining({ code: "INTERNAL_SERVER_ERROR" }));
			expect(test.invoke(rocio, "probe.countNotes")).toBe(0);
			expect(test.log()).toEqual([]);
			expect(test.background.jobs()).toEqual([]);
		},
	);

	it("from a read fails it as internal and leaves nothing", async () => {
		alsoNotifies("countNotes", { type: "note", id: 1 });
		const { test, rocio } = await household();
		await using _ = test;

		expect(() => test.invoke(rocio, "probe.countNotes")).toThrow(
			expect.objectContaining({ code: "INTERNAL_SERVER_ERROR" }),
		);
		expect(test.background.jobs()).toEqual([]);
	});

	it("carries only the recipient and the record, with the write's entry", async () => {
		const { test, rocio } = await household();
		await using _ = test;

		const note = publicNote(test, rocio, ["paco", "rocio"]);

		expect(
			test.background.jobs().map(({ kind, state, payload, entry }) => ({
				kind,
				state,
				payload,
				entry,
			})),
		).toEqual(
			["paco", "rocio"].map((to) => ({
				kind: "notice",
				state: "pending",
				payload: { to, module: "probe", type: "note", id: note.id },
				entry: note.entry,
			})),
		);
	});

	it("once: the same write again under its key leaves no other notice", async () => {
		const { test, rocio } = await household();
		await using _ = test;
		const input = { body: "pan", notify: ["paco"] };

		test.invoke(rocio, "probe.addNote", input, { idempotencyKey: "add" });
		expect(test.invoke(rocio, "probe.addNote", input, { idempotencyKey: "add" })).toEqual(
			expect.objectContaining({ repeated: true }),
		);

		expect(jobsOf(test, "notice")).toHaveLength(1);
	});

	it("from editing a note reaches its recipient about that note", async () => {
		const { test, push, rocio } = await household();
		await using _ = test;
		const client = await subscribed(await signedIn(test, "paco"), "paco-phone");

		const note = publicNote(test, rocio, ["paco"]);
		await test.background.runDue();

		expect(push.requests.map((request) => client.read(request))).toEqual([
			expect.objectContaining({ module: "probe", type: "note", id: note.id }),
		]);
	});
});

/**
 * An interleave that holds the first arrival at `point` until the test releases it, or fails it there. Every other
 * point, sign-ins' `entering` included, goes on.
 */
function holdAt(point: InterleavePoint) {
	let armed = true;
	let reach = () => undefined as void;
	const reached = new Promise<void>((resolve) => {
		reach = resolve;
	});
	let settle: (failure?: Error) => void = () => undefined;
	const released = new Promise<void>((resolve, reject) => {
		settle = (failure) => (failure ? reject(failure) : resolve());
	});
	return {
		interleave: (at: InterleavePoint) => {
			if (at !== point || !armed) return undefined;
			armed = false;
			reach();
			return released;
		},
		reached,
		release: () => settle(),
		fail: () => settle(new Error("the test fails it here")),
	};
}

describe("undoing the write of a notice", () => {
	it("before it is shared out cancels it: it never runs", async () => {
		const { test, push, rocio } = await household();
		await using _ = test;
		await subscribed(await signedIn(test, "paco"), "paco-phone");

		const note = publicNote(test, rocio, ["paco"]);
		test.undo(rocio, note.entry, { idempotencyKey: "undo" });
		await test.background.runDue();

		expect(jobsOf(test, "notice")).toEqual([
			expect.objectContaining({ state: "cancelled", outcome: null, error: "undone" }),
		]);
		expect(jobsOf(test, "delivery")).toEqual([]);
		expect(push.requests).toEqual([]);
	});

	it("while its job is claimed and before its sharing out ends it undone, without deliveries", async () => {
		const hold = holdAt("distributing");
		const { test, push, rocio } = await household({ interleave: hold.interleave });
		await using _ = test;
		await subscribed(await signedIn(test, "paco"), "paco-phone");

		const note = publicNote(test, rocio, ["paco"]);
		await hold.reached;
		test.undo(rocio, note.entry, { idempotencyKey: "undo" });
		hold.release();
		await test.background.runDue();

		expect(jobsOf(test, "notice")).toEqual([
			expect.objectContaining({ state: "done", outcome: "undone" }),
		]);
		expect(jobsOf(test, "delivery")).toEqual([]);
		expect(push.requests).toEqual([]);
	});

	it("once it is shared out cancels its pending deliveries: nothing goes out", async () => {
		const hold = holdAt("distributed");
		const { test, push, rocio } = await household({ interleave: hold.interleave });
		await using _ = test;
		await subscribed(await signedIn(test, "paco"), "paco-phone");
		await subscribed(await signedIn(test, "paco"), "paco-laptop");

		const note = publicNote(test, rocio, ["paco"]);
		await hold.reached;
		test.undo(rocio, note.entry, { idempotencyKey: "undo" });
		hold.release();
		await test.background.runDue();

		expect(jobsOf(test, "notice")).toEqual([
			expect.objectContaining({ state: "done", outcome: "distributed" }),
		]);
		expect(jobsOf(test, "delivery")).toEqual([
			expect.objectContaining({ state: "cancelled", error: "undone" }),
			expect.objectContaining({ state: "cancelled", error: "undone" }),
		]);
		expect(push.requests).toEqual([]);
	});
});

describe("sharing a notice out again", () => {
	it("after a failure once its deliveries were committed retries it without a second batch", async () => {
		const hold = holdAt("distributed");
		const { test, push, rocio } = await household({ interleave: hold.interleave });
		await using _ = test;
		await subscribed(await signedIn(test, "paco"), "paco-phone");
		await subscribed(await signedIn(test, "paco"), "paco-laptop");

		publicNote(test, rocio, ["paco"]);
		await hold.reached;
		hold.fail();
		await test.background.runDue();
		expect(jobsOf(test, "notice")).toEqual([
			expect.objectContaining({ state: "pending", error: "Error" }),
		]);

		test.clock.advance(FIRST_RETRY);
		await test.background.runDue();

		expect(jobsOf(test, "notice")).toEqual([
			expect.objectContaining({ state: "done", outcome: "distributed" }),
		]);
		expect(jobsOf(test, "delivery")).toEqual([
			expect.objectContaining({ state: "done", outcome: "sent" }),
			expect.objectContaining({ state: "done", outcome: "sent" }),
		]);
		expect(push.requests).toHaveLength(2);
	});

	it("after the process died once its deliveries were committed recovers it without a second batch", async () => {
		const folder = mkdtempSync(join(tmpdir(), "domus-notices-"));
		try {
			const file = join(folder, "domus.db");
			const clients: PushClient[] = [];
			{
				const { test, rocio } = await household({ file, started: false });
				await using _ = test;
				clients.push(await subscribed(await signedIn(test, "paco"), "paco-phone"));
				clients.push(await subscribed(await signedIn(test, "paco"), "paco-laptop"));
				publicNote(test, rocio, ["paco"]);
			}

			const child = await startChild({
				hold: "distribute",
				dataDirectory: folder,
				now: TEST_START,
				modules: [new URL("../server/index.ts", import.meta.url).href],
			});
			await child.kill();

			const push = fakePushService();
			await using test = createTestPlatform({ modules: [probe], file, push });
			test.background.start();
			await test.background.runDue();

			expect(jobsOf(test, "notice")).toEqual([
				expect.objectContaining({ state: "done", outcome: "distributed" }),
			]);
			expect(test.background.jobs().find(({ kind }) => kind === "notice")?.attempts).toBe(2);
			expect(jobsOf(test, "delivery")).toEqual([
				expect.objectContaining({ state: "done", outcome: "sent" }),
				expect.objectContaining({ state: "done", outcome: "sent" }),
			]);
			expect([...reached(push)].sort()).toEqual(
				clients.map(({ endpoint }) => endpoint).sort(),
			);
		} finally {
			rmSync(folder, { recursive: true, force: true });
		}
	});
});

/** What a test does to a delivery's world while it waits at `delivering`. */
interface Meanwhile {
	readonly test: Probe;
	readonly rocio: VerifiedContext;
	readonly note: number;
	/** Paco's browser, whose device has the subscription. */
	readonly phone: TestBrowser;
	/** Makes the next sign-in fail once it wrote its device's entry. */
	readonly failNextEntering: () => void;
}

describe("a delivery checked right before it sends", () => {
	it.each<[string, string, (meanwhile: Meanwhile) => unknown]>([
		[
			"the recipient lost read in the area",
			"not-visible",
			({ test }) => test.prepare.grant("paco", "probe", "none"),
		],
		[
			"the note was deleted",
			"record-gone",
			({ test, rocio, note }) =>
				test.invoke(rocio, "probe.deleteNote", { id: note }, { idempotencyKey: "delete" }),
		],
		[
			"the note became private",
			"not-visible",
			({ test, rocio, note }) =>
				test.invoke(
					rocio,
					"probe.setNoteVisibility",
					{ id: note, visibility: "private" },
					{ idempotencyKey: "hide" },
				),
		],
		[
			"the session signed out, and its subscription went with it",
			"subscription-gone",
			({ phone }) => phone.signOut(),
		],
		[
			"the session expired",
			"session-ended",
			({ test, phone }) => {
				const expiry = test.sessionExpiresAt(test.contextOf(phone).session ?? "");
				if (expiry === undefined) throw new Error("the session has no expiry");
				// Months after the test's start: without waking, so the daily cleanup does not run meanwhile.
				test.clock.set(expiry, { wake: false });
			},
		],
		[
			"another account entered the device",
			"subscription-gone",
			({ phone }) => phone.signIn("rocio@domus.test", PASSWORD),
		],
		[
			"a sign-in on the device failed once it wrote the device's entry",
			"not-enabled",
			async ({ phone, failNextEntering }) => {
				failNextEntering();
				expect((await phone.signIn("rocio@domus.test", PASSWORD)).status).not.toBe(200);
			},
		],
	])("sends nothing when %s, and ends %s", async (_, outcome, change) => {
		const hold = holdAt("delivering");
		let failing = false;
		const { test, push, rocio } = await household({
			interleave: (point) => {
				if (point === "entering" && failing) {
					failing = false;
					throw new Error("the creation fails here");
				}
				return hold.interleave(point);
			},
		});
		await using _platform = test;
		const phone = await signedIn(test, "paco");
		await subscribed(phone, "paco-phone");

		const { id: note } = publicNote(test, rocio, ["paco"]);
		await hold.reached;
		await change({
			test,
			rocio,
			note,
			phone,
			failNextEntering: () => {
				failing = true;
			},
		});
		hold.release();
		await test.background.settled();

		expect(jobsOf(test, "delivery")).toEqual([
			expect.objectContaining({ state: "done", outcome, error: null }),
		]);
		expect(push.requests).toEqual([]);
	});

	it("of a session does not pass to the account that enters the device after it and subscribes it again", async () => {
		const hold = holdAt("distributed");
		const { test, push, rocio } = await household({ interleave: hold.interleave });
		await using _ = test;
		const phone = await signedIn(test, "paco");
		const client = await subscribed(phone, "paco-phone");

		publicNote(test, rocio, ["paco"]);
		await hold.reached;
		// The same browser, so the same endpoint and keys, now from Rocío's session.
		expect((await phone.signIn("rocio@domus.test", PASSWORD)).status).toBe(200);
		const response = await phone.fetch(
			new Request(new URL("/api/notifications/subscription", TEST_ORIGIN), {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ endpoint: client.endpoint, keys: client.keys }),
			}),
		);
		expect(response.status).toBe(200);
		hold.release();
		await test.background.runDue();

		expect(jobsOf(test, "delivery")).toEqual([
			expect.objectContaining({ state: "done", outcome: "subscription-gone" }),
		]);
		expect(push.requests).toEqual([]);
	});
});

describe("a delivery that cannot be signed or encrypted", () => {
	it("fails for good with PUSH_ENDPOINT_NOT_ALLOWED when its service left the list after subscribing, and sends nothing", async () => {
		const { test, push, rocio } = await household();
		await using _ = test;
		await subscribed(await signedIn(test, "paco"), "paco-phone");

		push.hosts.splice(0);
		publicNote(test, rocio, ["paco"]);
		await test.background.runDue();

		expect(jobsOf(test, "delivery")).toEqual([
			expect.objectContaining({
				state: "failed",
				error: expect.stringMatching(/^PermanentJobError PUSH_ENDPOINT_NOT_ALLOWED: /),
			}),
		]);
		expect(push.requests).toEqual([]);
	});

	it("fails for good with PUSH_NOT_CONFIGURED when the platform has no https origin, and sends nothing", async () => {
		const { test, push, rocio } = await household({ origins: [TEST_ORIGIN] });
		await using _ = test;
		await subscribed(await signedIn(test, "paco"), "paco-phone");

		publicNote(test, rocio, ["paco"]);
		await test.background.runDue();

		expect(jobsOf(test, "delivery")).toEqual([
			expect.objectContaining({
				state: "failed",
				error: expect.stringMatching(/^PermanentJobError PUSH_NOT_CONFIGURED: /),
			}),
		]);
		expect(push.requests).toEqual([]);
	});

	it("fails for good with PUSH_KEYS_INVALID when the subscription's keys are not a browser's, and sends nothing", async () => {
		const { test, push, rocio } = await household();
		await using _ = test;
		const phone = await signedIn(test, "paco");
		const response = await phone.fetch(
			new Request(new URL("/api/notifications/subscription", TEST_ORIGIN), {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					endpoint: pushClient("broken").endpoint,
					keys: { p256dh: "not-a-key", auth: "not-a-secret" },
				}),
			}),
		);
		expect(response.status).toBe(200);

		publicNote(test, rocio, ["paco"]);
		await test.background.runDue();

		expect(jobsOf(test, "delivery")).toEqual([
			expect.objectContaining({
				state: "failed",
				error: expect.stringMatching(/^PermanentJobError PUSH_KEYS_INVALID: /),
			}),
		]);
		expect(push.requests).toEqual([]);
	});
});

/** Rocío's label of the household, which notifies `to`: its id. */
function label(test: Probe, rocio: VerifiedContext, to: readonly string[]): number {
	const added = test.invoke(
		rocio,
		"probe.addLabel",
		{ name: "urgente", notify: [...to] },
		{ idempotencyKey: "label" },
	);
	if (!("result" in added)) throw new Error("expected the write's result");
	return added.result.id;
}

describe("a notice about a label, a record of an area table", () => {
	it("reaches the other person, who owns nothing there, with only its destination", async () => {
		const { test, push, rocio } = await household();
		await using _ = test;
		const pacoPhone = await subscribed(await signedIn(test, "paco"), "paco-phone");

		const id = label(test, rocio, ["paco"]);
		await test.background.runDue();

		const [notice] = jobsOf(test, "notice");
		expect(notice).toEqual(expect.objectContaining({ state: "done", outcome: "distributed" }));
		expect(jobsOf(test, "delivery")).toEqual([
			expect.objectContaining({ state: "done", outcome: "sent" }),
		]);
		expect(reached(push)).toEqual([pacoPhone.endpoint]);
		expect(pacoPhone.read(push.requests[0]!)).toEqual({
			module: "probe",
			type: "label",
			id,
			notice: notice?.id,
		});
	});

	it("deleted before it is shared out ends record-gone, without deliveries", async () => {
		const { test, push, rocio, paco } = await household();
		await using _ = test;
		await subscribed(await signedIn(test, "paco"), "paco-phone");

		const id = label(test, rocio, ["paco"]);
		test.invoke(paco, "probe.deleteLabel", { id }, { idempotencyKey: "delete" });
		await test.background.runDue();

		expect(jobsOf(test, "notice")).toEqual([
			expect.objectContaining({ state: "done", outcome: "record-gone" }),
		]);
		expect(jobsOf(test, "delivery")).toEqual([]);
		expect(push.requests).toEqual([]);
	});

	it("to a person who lost read in its area ends not-visible, without deliveries", async () => {
		const { test, push, rocio } = await household();
		await using _ = test;
		await subscribed(await signedIn(test, "paco"), "paco-phone");

		label(test, rocio, ["paco"]);
		test.prepare.grant("paco", "probe", "none");
		await test.background.runDue();

		expect(jobsOf(test, "notice")).toEqual([
			expect.objectContaining({ state: "done", outcome: "not-visible" }),
		]);
		expect(jobsOf(test, "delivery")).toEqual([]);
		expect(push.requests).toEqual([]);
	});

	it.each<[string, string, (test: Probe, paco: VerifiedContext, id: number) => unknown]>([
		[
			"the label was deleted",
			"record-gone",
			(test, paco, id) =>
				test.invoke(paco, "probe.deleteLabel", { id }, { idempotencyKey: "delete" }),
		],
		[
			"the recipient lost read in its area",
			"not-visible",
			(test) => test.prepare.grant("paco", "probe", "none"),
		],
	])(
		"whose delivery is checked once %s sends nothing, and ends %s",
		async (_, outcome, change) => {
			const hold = holdAt("delivering");
			const { test, push, rocio, paco } = await household({ interleave: hold.interleave });
			await using _platform = test;
			await subscribed(await signedIn(test, "paco"), "paco-phone");

			const id = label(test, rocio, ["paco"]);
			await hold.reached;
			change(test, paco, id);
			hold.release();
			await test.background.settled();

			expect(jobsOf(test, "delivery")).toEqual([
				expect.objectContaining({ state: "done", outcome, error: null }),
			]);
			expect(push.requests).toEqual([]);
		},
	);
});

describe("leaving a notice about a table the platform does not know", () => {
	it("rolls the write back as internal, though the table exists in the module", async () => {
		alsoNotifies("addNote", { type: "scrap", id: 1 });
		const { test, rocio } = await household();
		await using _ = test;

		expect(() =>
			test.invoke(rocio, "probe.addNote", { body: "pan" }, { idempotencyKey: "add" }),
		).toThrow(expect.objectContaining({ code: "INTERNAL_SERVER_ERROR" }));
		expect(test.invoke(rocio, "probe.countNotes")).toBe(0);
		expect(test.background.jobs()).toEqual([]);
	});
});

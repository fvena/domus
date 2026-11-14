// The live channel (spec of phase 1d4, «El canal» and «El reparto de invalidaciones»): `GET /api/events` with a
// session tells each session which records it can see changed, never their content, once their write committed.
// Each test reads the stream of the door as a browser would. A heartbeat, 25 s of the test clock, closes what each
// step expects: whatever was due on a channel before it comes first, so "nothing else arrived" is checked by it.
import type { ModuleDatabase } from "@domus/module-sdk";
import { eq } from "@domus/module-sdk/db";
import {
	createTestPlatform,
	type EventReader,
	openChannel,
	TEST_ORIGIN,
	type TestBrowser,
	type TestPlatform,
} from "@domus/test-utils";
import { afterEach, describe, expect, it, type MockInstance, vi } from "vitest";

import probe from "../server";
import { notes as notesTable, scraps } from "../server/schema";

type Probe = TestPlatform<readonly [typeof probe]>;

const PASSWORD = "correct horse battery staple";
const HEARTBEAT = 25_000;
const READY = { event: "ready", data: {} };
const PURGE = { event: "purge", data: {} };

/** An invalidation of probe's notes. */
function notes(...ids: number[]) {
	return {
		event: "invalidate",
		data: { records: ids.map((id) => ({ module: "probe", type: "note", id })) },
	};
}

/** An invalidation of probe's board notes. */
function boardNotes(...ids: number[]) {
	return {
		event: "invalidate",
		data: { records: ids.map((id) => ({ module: "probe", type: "board", id })) },
	};
}

/** An invalidation of probe's labels, an area table. */
function labels(...ids: number[]) {
	return {
		event: "invalidate",
		data: { records: ids.map((id) => ({ module: "probe", type: "label", id })) },
	};
}

const spies: MockInstance[] = [];
afterEach(() => {
	for (const spy of spies.splice(0)) spy.mockRestore();
});

/** What a wrapped handler of probe receives, as much as these tests use. */
interface HandlerContext {
	readonly db: ModuleDatabase<typeof probe.schema>;
	readonly input: { readonly id: number };
}

/**
 * Wraps probe's handler `name`: `after` runs inside the same write once the handler did its work. The platform
 * registers the definition's handler when it opens, so this goes before the platform.
 */
function wrap(name: string, after: (context: HandlerContext) => void): void {
	const actions = probe.actions as unknown as Record<
		string,
		(context: HandlerContext) => unknown
	>;
	const original = actions[name];
	if (!original) throw new Error(`probe has no ${name}`);
	spies.push(
		vi.spyOn(actions, name).mockImplementation((context) => {
			const outcome = original(context);
			after(context);
			return outcome;
		}),
	);
}

/** Room enough on the volume for every upload of these tests, whatever the machine has free. */
const ROOMY = () => 100 * 1024 * 1024 * 1024;

/** The start of a JPEG and a few bytes of it: enough for its signature. */
const JPEG = Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00);

/** A platform with probe where Ana and Luis, members, and the device account each have a password. */
async function household(options: { readonly channelQueue?: number } = {}) {
	const test = createTestPlatform({ modules: [probe], freeSpace: ROOMY, ...options });
	for (const id of ["ana", "luis"]) {
		test.prepare.account({ id, role: "member" });
		await test.prepare.password(id, PASSWORD);
	}
	await test.prepare.password(test.deviceAccount, PASSWORD);
	return test;
}

/** A browser signed in with `email`. */
async function signedIn(test: Probe, email: string): Promise<TestBrowser> {
	const browser = test.browser();
	const response = await browser.signIn(email, PASSWORD);
	expect(response.status).toBe(200);
	return browser;
}

/** A browser of `email` with its channel open and its `ready` read, and the context of its session. */
async function listening(test: Probe, email: string) {
	const browser = await signedIn(test, email);
	const channel = await openChannel(browser);
	expect(await channel.next()).toEqual(READY);
	return { browser, channel, context: test.contextOf(browser) };
}

/** Ana's and Luis's browsers, each listening. */
async function bothListening(test: Probe) {
	return {
		ana: await listening(test, "ana@domus.test"),
		luis: await listening(test, "luis@domus.test"),
	};
}

/** Moves the clock one heartbeat on: every channel gets one after whatever it already had due. */
function beat(test: Probe): void {
	test.clock.advance(HEARTBEAT);
}

/** What `channel` reads next, until its heartbeat: the events before it, in order. */
async function untilBeat(channel: EventReader): Promise<unknown[]> {
	const read: unknown[] = [];
	for (;;) {
		const item = await channel.next();
		if (item === "end") throw new Error(`the channel ended after ${JSON.stringify(read)}`);
		if ("comment" in item) return read;
		read.push(item);
	}
}

/**
 * When the session of `first` expires, which must be before the session of `then`: Better Auth sets each from the
 * real time of signing in.
 */
function expiries(
	test: Probe,
	first: { readonly context: { readonly session?: string } },
	then: { readonly context: { readonly session?: string } },
): number {
	const [early, late] = [first, then].map(({ context }) =>
		context.session === undefined ? undefined : test.sessionExpiresAt(context.session),
	);
	if (early === undefined || late === undefined) throw new Error("a session is missing");
	expect(late).toBeGreaterThan(early);
	return early;
}

/** Everything `channel` reads until its stream ends. */
async function untilEnd(channel: EventReader): Promise<unknown[]> {
	const read: unknown[] = [];
	for (let item = await channel.next(); item !== "end"; item = await channel.next())
		read.push(item);
	return read;
}

let keys = 0;
/** A fresh idempotency key. */
function key() {
	keys += 1;
	return { idempotencyKey: `k${keys}` };
}

describe("the live channel", () => {
	it("tells both people of a new public note, and only its owner of a private one", async () => {
		await using test = await household();
		const { ana, luis } = await bothListening(test);

		test.invoke(ana.context, "probe.addNote", { body: "leche" }, key());
		test.invoke(ana.context, "probe.addNote", { body: "regalo" }, key());
		test.invoke(ana.context, "probe.setNoteVisibility", { id: 1, visibility: "public" }, key());
		beat(test);

		expect(await untilBeat(ana.channel)).toEqual([notes(1), notes(2), notes(1)]);
		expect(await untilBeat(luis.channel)).toEqual([notes(1)]);
	});

	it("tells the former reader of a note made private, and the new reader of one made public", async () => {
		await using test = await household();
		const { ana, luis } = await bothListening(test);
		test.invoke(ana.context, "probe.addNote", { body: "leche" }, key());
		test.invoke(ana.context, "probe.setNoteVisibility", { id: 1, visibility: "public" }, key());
		beat(test);
		expect(await untilBeat(luis.channel)).toEqual([notes(1)]);
		expect(await untilBeat(ana.channel)).toEqual([notes(1), notes(1)]);

		test.invoke(
			ana.context,
			"probe.setNoteVisibility",
			{ id: 1, visibility: "private" },
			key(),
		);
		test.invoke(ana.context, "probe.editNote", { id: 1, body: "leche entera" }, key());
		beat(test);

		expect(await untilBeat(luis.channel)).toEqual([notes(1)]);
		expect(await untilBeat(ana.channel)).toEqual([notes(1), notes(1)]);
		expect(test.invoke(luis.context, "probe.getNote", { id: 1 })).toBeNull();
	});

	it("does not tell another person of a note made public and private again in the same write", async () => {
		wrap("setNoteVisibility", ({ db, input }) => {
			db.update(notesTable)
				.set({ visibility: "private" })
				.where(eq(notesTable.id, input.id))
				.run();
		});
		await using test = await household();
		const { ana, luis } = await bothListening(test);
		test.invoke(ana.context, "probe.addNote", { body: "regalo" }, key());

		test.invoke(ana.context, "probe.setNoteVisibility", { id: 1, visibility: "public" }, key());
		beat(test);

		expect(await untilBeat(luis.channel)).toEqual([]);
		expect(await untilBeat(ana.channel)).toEqual([notes(1), notes(1)]);
	});

	it("tells nobody of a write that rolls back", async () => {
		wrap("editNote", () => {
			throw new Error("a failure after the handler's work");
		});
		await using test = await household();
		const { ana } = await bothListening(test);
		test.invoke(ana.context, "probe.addNote", { body: "leche" }, key());

		expect(() =>
			test.invoke(ana.context, "probe.editNote", { id: 1, body: "pan" }, key()),
		).toThrow(expect.objectContaining({ code: "INTERNAL_SERVER_ERROR" }));
		beat(test);

		expect(await untilBeat(ana.channel)).toEqual([notes(1)]);
	});

	it("tells whoever saw or sees what an undo changes again", async () => {
		await using test = await household();
		const { ana, luis } = await bothListening(test);
		test.invoke(ana.context, "probe.addNote", { body: "leche" }, key());
		const shared = test.invoke(
			ana.context,
			"probe.setNoteVisibility",
			{ id: 1, visibility: "public" },
			key(),
		);
		beat(test);
		expect(await untilBeat(luis.channel)).toEqual([notes(1)]);
		expect(await untilBeat(ana.channel)).toEqual([notes(1), notes(1)]);

		test.undo(ana.context, shared.entry, key());
		beat(test);

		expect(await untilBeat(luis.channel)).toEqual([notes(1)]);
		expect(await untilBeat(ana.channel)).toEqual([notes(1)]);
	});

	it("tells nothing of an area to a session without read in it, and the device account what is public", async () => {
		await using test = await household();
		test.prepare.grant("luis", "probe", "none");
		const { ana, luis } = await bothListening(test);
		const screen = await listening(test, "device@domus.invalid");

		test.invoke(ana.context, "probe.addNote", { body: "leche" }, key());
		test.invoke(ana.context, "probe.setNoteVisibility", { id: 1, visibility: "public" }, key());
		test.invoke(ana.context, "probe.addBoardNote", { body: "cena a las nueve" }, key());
		beat(test);

		expect(await untilBeat(luis.channel)).toEqual([boardNotes(1)]);
		expect(await untilBeat(screen.channel)).toEqual([notes(1), boardNotes(1)]);
		expect(await untilBeat(ana.channel)).toEqual([notes(1), notes(1), boardNotes(1)]);
	});

	it("sends each channel one invalidation per write, each record once, as { module, type, id }", async () => {
		wrap("editNote", ({ db, input }) => {
			db.update(notesTable)
				.set({ body: "otra vez" })
				.where(eq(notesTable.id, input.id))
				.run();
		});
		await using test = await household();
		// Configuring every note of one's own at once asks for manage.
		test.prepare.grant("ana", "probe", "manage");
		const { ana, luis } = await bothListening(test);
		for (const body of ["leche", "pan"])
			test.invoke(ana.context, "probe.addNote", { body }, key());
		const configure = { action: "probe.configure", input: { visibility: "public" } } as const;
		const { proof } = await test.requestProof(ana.context, PASSWORD, configure);
		test.invoke(ana.context, "probe.configure", configure.input, { ...key(), proof });
		test.invoke(ana.context, "probe.editNote", { id: 2, body: "pan de leña" }, key());
		beat(test);

		expect(await untilBeat(luis.channel)).toEqual([notes(1, 2), notes(2)]);
		expect(await untilBeat(ana.channel)).toEqual([notes(1), notes(2), notes(1, 2), notes(2)]);
	});

	it("sends ready before any invalidation, and every write committed after it", async () => {
		await using test = await household();
		const ana = await signedIn(test, "ana@domus.test");
		const context = test.contextOf(ana);
		test.invoke(context, "probe.addNote", { body: "antes" }, key());
		const channel = await openChannel(ana);

		test.invoke(context, "probe.addNote", { body: "después" }, key());
		beat(test);

		expect(await untilBeat(channel)).toEqual([READY, notes(2)]);
	});

	it("sends the events in the order their writes committed, whoever wrote them", async () => {
		await using test = await household();
		const { ana, luis } = await bothListening(test);

		test.invoke(ana.context, "probe.addBoardNote", { body: "uno" }, key());
		test.invoke(luis.context, "probe.addBoardNote", { body: "dos" }, key());
		await Promise.resolve();
		test.invoke(ana.context, "probe.editBoardNote", { id: 2, body: "dos y medio" }, key());
		test.invoke(luis.context, "probe.addBoardNote", { body: "tres" }, key());
		beat(test);

		const order = [boardNotes(1), boardNotes(2), boardNotes(2), boardNotes(3)];
		expect(await untilBeat(ana.channel)).toEqual(order);
		expect(await untilBeat(luis.channel)).toEqual(order);
	});

	it("cuts the oldest channel of a session when it opens a seventh, without purge", async () => {
		await using test = await household();
		const ana = await signedIn(test, "ana@domus.test");
		const channels = [];
		for (let tab = 0; tab < 6; tab += 1) channels.push(await openChannel(ana));
		const luis = await listening(test, "luis@domus.test");

		const seventh = await openChannel(ana);

		expect(await untilEnd(channels[0]!)).toEqual([READY]);
		test.invoke(test.contextOf(ana), "probe.addNote", { body: "leche" }, key());
		beat(test);
		for (const open of [...channels.slice(1), seventh])
			expect(await untilBeat(open)).toEqual([READY, notes(1)]);
		expect(await untilBeat(luis.channel)).toEqual([]);
	});

	it("cuts a channel whose queue goes past its limit, which then grows no more", async () => {
		await using test = await household({ channelQueue: 3 });
		const { ana } = await bothListening(test);

		// Ana's tab stops reading: whatever the stream can hold aside, the rest waits in the channel's queue.
		for (let note = 1; note <= 20; note += 1)
			test.invoke(ana.context, "probe.addNote", { body: `nota ${note}` }, key());
		await Promise.resolve();
		for (let note = 1; note <= 20; note += 1)
			test.invoke(ana.context, "probe.editNote", { id: note, body: "otra" }, key());
		beat(test);

		const read = await untilEnd(ana.channel);
		expect(read.length).toBeLessThan(20);
		expect(read).toEqual(read.map((_, at) => notes(at + 1)));
		expect(read).not.toContainEqual(PURGE);

		// A new tab of the same session gets what comes now.
		const again = await openChannel(ana.browser);
		test.invoke(ana.context, "probe.addNote", { body: "nueva" }, key());
		beat(test);
		expect(await untilBeat(again)).toEqual([READY, notes(21)]);
	});

	it("beats every 25 s of the clock, and ends with purge once the session expired", async () => {
		await using test = await household();
		const { ana, luis } = await bothListening(test);

		test.clock.advance(HEARTBEAT - 1);
		test.invoke(ana.context, "probe.addNote", { body: "leche" }, key());
		test.clock.advance(1);
		expect(await untilBeat(ana.channel)).toEqual([notes(1)]);
		expect(await untilBeat(luis.channel)).toEqual([]);

		const expiry = expiries(test, ana, luis);
		test.clock.set(expiry);
		expect(test.hasSession(ana.context.session!)).toBe(true);

		expect(await untilEnd(ana.channel)).toEqual([PURGE]);
		// Luis's session lives a little longer: its channel beat and goes on.
		expect(await untilBeat(luis.channel)).toEqual([]);
		test.invoke(luis.context, "probe.addBoardNote", { body: "cena" }, key());
		expect(await luis.channel.next()).toEqual(boardNotes(1));
	});

	it("ends with purge a channel whose session expired before a write reaches it, between beats", async () => {
		await using test = await household();
		const { ana, luis } = await bothListening(test);
		test.clock.set(expiries(test, ana, luis), { wake: false });

		test.invoke(luis.context, "probe.addBoardNote", { body: "cena" }, key());

		expect(await untilEnd(ana.channel)).toEqual([PURGE]);
		expect(await luis.channel.next()).toEqual(boardNotes(1));
	});

	it("answers 401 in JSON without a session or with one that expired, never cached", async () => {
		await using test = await household();
		const stranger = test.browser();
		const ana = await signedIn(test, "ana@domus.test");
		const request = () => new Request(new URL("/api/events", TEST_ORIGIN));

		const refused = await stranger.fetch(request());
		expect(refused.status).toBe(401);
		expect(refused.headers.get("cache-control")).toBe("no-store");
		expect(await refused.json()).toMatchObject({ defined: false, code: "UNAUTHORIZED" });

		const open = await ana.fetch(request());
		expect(open.status).toBe(200);
		expect(open.headers.get("content-type")).toBe("text/event-stream");
		expect(open.headers.get("cache-control")).toBe("no-store");
		await open.body?.cancel();

		const expiry = test.sessionExpiresAt(test.contextOf(ana).session!);
		if (expiry === undefined) throw new Error("Ana has no session");
		test.clock.set(expiry);
		const expired = await ana.fetch(request());
		expect(expired.status).toBe(401);
		expect(await expired.json()).toMatchObject({ code: "UNAUTHORIZED" });
	});
});

describe("an area table on the live channel", () => {
	it("tells every session with read in its area of a new label, and none without it", async () => {
		await using test = await household();
		test.prepare.account({ id: "marta", role: "member" });
		await test.prepare.password("marta", PASSWORD);
		test.prepare.grant("marta", "probe", "none");
		const { ana, luis } = await bothListening(test);
		const screen = await listening(test, "device@domus.invalid");
		const marta = await listening(test, "marta@domus.test");

		test.invoke(ana.context, "probe.addLabel", { name: "urgente" }, key());
		beat(test);

		expect(await untilBeat(ana.channel)).toEqual([labels(1)]);
		expect(await untilBeat(luis.channel)).toEqual([labels(1)]);
		expect(await untilBeat(screen.channel)).toEqual([labels(1)]);
		expect(await untilBeat(marta.channel)).toEqual([]);
	});

	it("tells of the label an undo deletes, and of the one a deletion takes", async () => {
		await using test = await household();
		const { ana, luis } = await bothListening(test);
		const added = test.invoke(ana.context, "probe.addLabel", { name: "urgente" }, key());
		test.invoke(ana.context, "probe.addLabel", { name: "casa" }, key());
		beat(test);
		expect(await untilBeat(luis.channel)).toEqual([labels(1), labels(2)]);
		expect(await untilBeat(ana.channel)).toEqual([labels(1), labels(2)]);

		test.undo(ana.context, added.entry, key());
		test.invoke(luis.context, "probe.deleteLabel", { id: 2 }, key());
		beat(test);

		expect(await untilBeat(luis.channel)).toEqual([labels(1), labels(2)]);
		expect(await untilBeat(ana.channel)).toEqual([labels(1), labels(2)]);
		expect(test.invoke(ana.context, "probe.listLabels", undefined)).toEqual([]);
	});

	it("tells nobody of a change in a table without an owner that does not declare itself an area table", async () => {
		alsoTouches("addLabel", ({ db }) => {
			const scrap = db
				.insert(scraps)
				.values({ body: "borrador" })
				.returning({ id: scraps.id })
				.get();
			return [{ type: "scrap", id: scrap.id }];
		});
		await using test = await household();
		const { ana, luis } = await bothListening(test);

		test.invoke(ana.context, "probe.addLabel", { name: "urgente" }, key());
		beat(test);

		expect(await untilBeat(ana.channel)).toEqual([labels(1)]);
		expect(await untilBeat(luis.channel)).toEqual([labels(1)]);
	});

	it("rolls back as internal a write that declares a label by an id that is not an integer", async () => {
		alsoTouches("addLabel", () => [{ type: "label", id: "1" }]);
		await using test = await household();
		const { ana } = await bothListening(test);

		expect(() =>
			test.invoke(ana.context, "probe.addLabel", { name: "urgente" }, key()),
		).toThrow(expect.objectContaining({ code: "INTERNAL_SERVER_ERROR" }));
		beat(test);

		expect(await untilBeat(ana.channel)).toEqual([]);
		expect(test.invoke(ana.context, "probe.listLabels", undefined)).toEqual([]);
	});
});

/** Uploads a photo from `browser` and returns the id of the prepared file. */
async function prepared(browser: TestBrowser): Promise<string> {
	const response = await browser.fetch(
		new Request(new URL("/api/files", TEST_ORIGIN), {
			method: "POST",
			body: JPEG,
			headers: { "content-length": String(JPEG.length), "x-file-name": "nevera.jpg" },
		}),
	);
	expect(response.status).toBe(200);
	return ((await response.json()) as { id: string }).id;
}

describe("files on the live channel", () => {
	it("tells the readers of a note that its files changed, and nobody else", async () => {
		await using test = await household();
		const { ana, luis } = await bothListening(test);
		test.invoke(ana.context, "probe.addNote", { body: "privada" }, key());
		test.invoke(ana.context, "probe.addNote", { body: "nevera" }, key());
		test.invoke(ana.context, "probe.setNoteVisibility", { id: 2, visibility: "public" }, key());
		beat(test);
		expect(await untilBeat(luis.channel)).toEqual([notes(2)]);
		expect(await untilBeat(ana.channel)).toEqual([notes(1), notes(2), notes(2)]);

		const photo = await prepared(ana.browser);
		const another = await prepared(ana.browser);
		test.invoke(ana.context, "probe.attachFile", { noteId: 1, prepared: photo }, key());
		const shared = test.invoke(
			ana.context,
			"probe.attachFile",
			{ noteId: 2, prepared: another },
			key(),
		);
		if ("repeated" in shared) throw new Error("attached before");
		const detached = test.invoke(
			ana.context,
			"probe.detachFile",
			{ noteId: 2, file: shared.result.id },
			key(),
		);
		test.undo(ana.context, detached.entry, key());
		beat(test);

		expect(await untilBeat(luis.channel)).toEqual([notes(2), notes(2), notes(2)]);
		expect(await untilBeat(ana.channel)).toEqual([notes(1), notes(2), notes(2), notes(2)]);
	});

	it("tells once of a note deleted with its file, and once of its undo", async () => {
		await using test = await household();
		const { ana, luis } = await bothListening(test);
		test.invoke(ana.context, "probe.addNote", { body: "nevera" }, key());
		test.invoke(ana.context, "probe.setNoteVisibility", { id: 1, visibility: "public" }, key());
		const photo = await prepared(ana.browser);
		test.invoke(ana.context, "probe.attachFile", { noteId: 1, prepared: photo }, key());
		beat(test);
		expect(await untilBeat(luis.channel)).toEqual([notes(1), notes(1)]);
		expect(await untilBeat(ana.channel)).toEqual([notes(1), notes(1), notes(1)]);

		const deleted = test.invoke(ana.context, "probe.deleteNote", { id: 1 }, key());
		test.undo(ana.context, deleted.entry, key());
		beat(test);

		expect(await untilBeat(luis.channel)).toEqual([notes(1), notes(1)]);
		expect(await untilBeat(ana.channel)).toEqual([notes(1), notes(1)]);
		expect(test.invoke(luis.context, "probe.getNote", { id: 1 })?.files).toHaveLength(1);
	});
});

/**
 * Wraps probe's handler `name`, before the platform registers it: inside the same write, once the handler did its
 * work, `more` may write and adds what it returns to the touched records the handler declared.
 */
function alsoTouches(name: string, more: (context: HandlerContext) => readonly unknown[]): void {
	const actions = probe.actions as unknown as Record<
		string,
		(context: HandlerContext) => { readonly touched: readonly unknown[] }
	>;
	const original = actions[name];
	if (!original) throw new Error(`probe has no ${name}`);
	spies.push(
		vi.spyOn(actions, name).mockImplementation((context) => {
			const outcome = original(context);
			return { ...outcome, touched: [...outcome.touched, ...more(context)] };
		}),
	);
}

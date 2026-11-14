// When the admin changes an account's permissions (spec of phase 1d4, «El reparto de invalidaciones», ADR 0029):
// once it commits, every channel of that account reads `reset`, and closes after it when the account lost `read` in
// an area; reconnecting, it gets what it may see now. Changing the delegation sends nothing: over HTTP the channel is
// always `app` and without `via`. Each test reads the stream of the door as a browser would; a heartbeat, 25 s of
// the test clock, closes what each step expects.
import {
	createTestPlatform,
	type EventReader,
	openChannel,
	type PermissionChange,
	type TestBrowser,
	type TestPlatform,
} from "@domus/test-utils";
import { describe, expect, it } from "vitest";

import probe from "../server";

type Probe = TestPlatform<readonly [typeof probe]>;

const PASSWORD = "correct horse battery staple";
const HEARTBEAT = 25_000;
const READY = { event: "ready", data: {} };
const RESET = { event: "reset", data: {} };

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

/** A platform with probe where Ana and Luis, members, and Eva, the admin, each have a password. */
async function household() {
	const test = createTestPlatform({ modules: [probe] });
	for (const [id, role] of [
		["ana", "member"],
		["luis", "member"],
		["eva", "admin"],
	] as const) {
		test.prepare.account({ id, role });
		await test.prepare.password(id, PASSWORD);
	}
	return test;
}

/** A browser signed in as `who`. */
async function signedIn(test: Probe, who: string): Promise<TestBrowser> {
	const browser = test.browser();
	expect((await browser.signIn(`${who}@domus.test`, PASSWORD)).status).toBe(200);
	return browser;
}

/** A channel open on `browser`, its `ready` read. */
async function opened(browser: TestBrowser): Promise<EventReader> {
	const channel = await openChannel(browser);
	expect(await channel.next()).toEqual(READY);
	return channel;
}

/** A browser of `who` with its channel open and its `ready` read, and the context of its session. */
async function listening(test: Probe, who: string) {
	const browser = await signedIn(test, who);
	return { browser, channel: await opened(browser), context: test.contextOf(browser) };
}

/** Everything `channel` reads until its stream ends. */
async function untilEnd(channel: EventReader): Promise<unknown[]> {
	const read: unknown[] = [];
	for (let item = await channel.next(); item !== "end"; item = await channel.next())
		read.push(item);
	return read;
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

let keys = 0;
/** A fresh idempotency key. */
function key() {
	keys += 1;
	return { idempotencyKey: `k${keys}` };
}

/** Eva sets `account`'s grant in `area`, with the proof it asks for. */
async function grant(test: Probe, change: PermissionChange) {
	const eva = test.context("eva");
	const { proof } = await test.requestProof(eva, PASSWORD, {
		action: "platform.setPermission",
		input: change,
	});
	test.setPermission(eva, change, { ...key(), proof });
}

describe("changing an account's permissions", () => {
	it("taking away read in an area writes reset on the account's channels and closes them; reconnected, that area no longer reaches it", async () => {
		await using test = await household();
		const phone = await listening(test, "ana");
		const laptop = await listening(test, "ana");
		const luis = await listening(test, "luis");

		await grant(test, { account: "ana", area: "probe.board", level: "none" });

		expect(await untilEnd(phone.channel)).toEqual([RESET]);
		expect(await untilEnd(laptop.channel)).toEqual([RESET]);
		test.clock.advance(HEARTBEAT);
		expect(await untilBeat(luis.channel)).toEqual([]);

		const again = await opened(phone.browser);
		test.invoke(luis.context, "probe.addBoardNote", { body: "cena" }, key());
		test.invoke(phone.context, "probe.addNote", { body: "leche" }, key());
		test.clock.advance(HEARTBEAT);
		expect(await untilBeat(again)).toEqual([notes(1)]);
		expect(await untilBeat(luis.channel)).toEqual([boardNotes(1)]);
	});

	it("giving read in an area writes reset without closing, and from then on its invalidations reach the account", async () => {
		await using test = await household();
		test.prepare.grant("luis", "probe.board", "none");
		const ana = await listening(test, "ana");
		const luis = await listening(test, "luis");
		test.invoke(ana.context, "probe.addBoardNote", { body: "cena" }, key());

		await grant(test, { account: "luis", area: "probe.board", level: "read" });
		test.invoke(ana.context, "probe.addBoardNote", { body: "postre" }, key());
		test.clock.advance(HEARTBEAT);

		expect(await untilBeat(luis.channel)).toEqual([RESET, boardNotes(2)]);
		expect(await untilBeat(ana.channel)).toEqual([boardNotes(1), boardNotes(2)]);
	});

	it("changing the delegation of the account sends nothing on its channels", async () => {
		await using test = await household();
		const ana = await listening(test, "ana");
		const change = { account: "ana", area: "probe", level: "write", value: "confirm" } as const;
		const { proof } = await test.requestProof(ana.context, PASSWORD, {
			action: "platform.setDelegation",
			input: change,
		});

		test.setDelegation(ana.context, change, { ...key(), proof });
		test.clock.advance(HEARTBEAT);

		expect(await untilBeat(ana.channel)).toEqual([]);
	});
});

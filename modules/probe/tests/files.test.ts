// Files of probe's notes (ADR 0028, spec of phase 1d3, «`ctx.files` y `fileRef()`», «Deshacer con referencias
// soltadas» and «Descargar»): a person uploads a photo through the door, attaches it to a note with an action,
// sees it in the note's reads, downloads it through the read that returned it, takes it off, deletes the note and
// undoes it all, and the photo comes back.
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	createTestPlatform,
	TEST_ORIGIN,
	type TestBrowser,
	type TestPlatform,
	type VerifiedContext,
} from "@domus/test-utils";
import { afterEach, describe, expect, it, type MockInstance, vi } from "vitest";

import probe from "../server";

const PASSWORD = "correct horse battery staple";

const DAY = 24 * 60 * 60 * 1000;

/** Room enough on the volume for every upload of these tests, whatever the machine has free. */
const ROOMY = () => 100 * 1024 * 1024 * 1024;

/** The start of a JPEG and a few bytes of it: enough for its signature. */
const JPEG = Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00);

type Probe = TestPlatform<readonly [typeof probe]>;

/** A platform with probe where Ana and Luis, members, have a password, and Ana has a note. */
async function household(): Promise<Probe> {
	const test = createTestPlatform({ modules: [probe], freeSpace: ROOMY });
	for (const id of ["ana", "luis"]) {
		test.prepare.account({ id, role: "member" });
		await test.prepare.password(id, PASSWORD);
	}
	test.invoke(test.context("ana"), "probe.addNote", { body: "nevera" }, { idempotencyKey: "n1" });
	return test;
}

async function signedIn(test: Probe, who: string): Promise<TestBrowser> {
	const browser = test.browser();
	expect((await browser.signIn(`${who}@domus.test`, PASSWORD)).status).toBe(200);
	return browser;
}

/** Uploads `bytes` from `browser` and returns the id of the prepared file. */
async function prepare(
	browser: TestBrowser,
	bytes: Uint8Array<ArrayBuffer> = JPEG,
	name = "nevera rota.jpg",
): Promise<string> {
	const response = await browser.fetch(
		new Request(new URL("/api/files", TEST_ORIGIN), {
			method: "POST",
			body: bytes,
			headers: {
				"content-length": String(bytes.length),
				"x-file-name": encodeURIComponent(name),
			},
		}),
	);
	expect(response.status).toBe(200);
	return ((await response.json()) as { id: string }).id;
}

/** Asks the door for `file` through the read `action` with `input`. */
function download(
	browser: TestBrowser,
	action: string,
	input: unknown,
	file: string,
): Promise<Response> {
	return browser.fetch(
		new Request(new URL("/api/files/download", TEST_ORIGIN), {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ action, input, file }),
		}),
	);
}

/** Attaches a prepared file to a note of the context's and returns the file's id. */
let keys = 0;
function attach(test: Probe, context: VerifiedContext, noteId: number, prepared: string): string {
	const outcome = test.invoke(
		context,
		"probe.attachFile",
		{ noteId, prepared },
		{ idempotencyKey: `attach-${String(++keys)}` },
	);
	if ("repeated" in outcome) throw new Error("attached before");
	return outcome.result.id;
}

/** The SHA-256 of what a download answers, once it answered 200. */
async function downloaded(
	browser: TestBrowser,
	action: string,
	input: unknown,
	file: string,
): Promise<string> {
	const response = await download(browser, action, input, file);
	expect(response.status).toBe(200);
	return sha256(new Uint8Array(await response.arrayBuffer()));
}

/** A write's receipt, failing the test on an acknowledgement. */
function written<T extends object>(outcome: T): Exclude<T, { readonly repeated: true }> {
	if ("repeated" in outcome) throw new Error("expected a first write");
	return outcome as Exclude<T, { readonly repeated: true }>;
}

/** The last entry of the action log. */
function lastEntry(test: Probe) {
	return test.log().slice(-1)[0];
}

/**
 * Makes the next run of probe's handler `name` fail once it did its work, as a write that breaks later would. The
 * platform registers the handler of the definition, so this goes before the platform opens.
 */
function failOnceAfter(name: "attachFile" | "detachFile" | "deleteNote" | "restoreNote"): void {
	const actions = probe.actions as Record<string, (context: never) => unknown>;
	const original = actions[name];
	if (!original) throw new Error(`probe has no ${name}`);
	spies.push(
		vi.spyOn(actions, name).mockImplementationOnce((context) => {
			original(context);
			throw new Error("a failure after the handler's work");
		}),
	);
}

const spies: MockInstance[] = [];
afterEach(() => {
	for (const spy of spies.splice(0)) spy.mockRestore();
});

function sha256(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

describe("attaching and downloading a file", () => {
	it("attaches an uploaded photo to a note, shows it in the read and downloads it whole", async () => {
		await using test = await household();
		const phone = await signedIn(test, "ana");
		const ana = test.contextOf(phone);
		const prepared = await prepare(phone);

		const attached = test.invoke(
			ana,
			"probe.attachFile",
			{ noteId: 1, prepared },
			{ idempotencyKey: "a1" },
		);

		const file = {
			id: expect.any(String),
			name: "nevera rota.jpg",
			type: "image/jpeg",
			size: JPEG.length,
		};
		expect(attached).toEqual({ result: file, entry: 2 });
		const note = test.invoke(ana, "probe.getNote", { id: 1 });
		expect(note).toEqual({ id: 1, body: "nevera", files: [file] });

		const id = note?.files[0]?.id ?? "";
		expect(id).not.toBe(prepared);
		const response = await download(phone, "probe.getNote", { id: 1 }, id);
		expect(response.status).toBe(200);
		expect(Object.fromEntries(response.headers)).toMatchObject({
			"cache-control": "no-store",
			"x-content-type-options": "nosniff",
			"content-type": "image/jpeg",
			"content-length": String(JPEG.length),
			"content-disposition": `attachment; filename="nevera rota.jpg"; filename*=UTF-8''nevera%20rota.jpg`,
		});
		expect(sha256(new Uint8Array(await response.arrayBuffer()))).toBe(sha256(JPEG));
	});

	it("lets nobody attach to a public note of another, and hides a private one, also from downloading", async () => {
		await using test = await household();
		const anaPhone = await signedIn(test, "ana");
		const ana = test.contextOf(anaPhone);
		const luisPhone = await signedIn(test, "luis");
		const luis = test.contextOf(luisPhone);
		const photo = attach(test, ana, 1, await prepare(anaPhone));
		const prepared = await prepare(luisPhone);

		expect(() =>
			test.invoke(
				luis,
				"probe.attachFile",
				{ noteId: 1, prepared },
				{ idempotencyKey: "l1" },
			),
		).toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
		expect(
			await (await download(luisPhone, "probe.getNote", { id: 1 }, photo)).json(),
		).toMatchObject({ code: "NOT_FOUND", status: 404 });

		test.invoke(
			ana,
			"probe.setNoteVisibility",
			{ id: 1, visibility: "public" },
			{ idempotencyKey: "v1" },
		);
		expect(() =>
			test.invoke(
				luis,
				"probe.attachFile",
				{ noteId: 1, prepared },
				{ idempotencyKey: "l2" },
			),
		).toThrow(expect.objectContaining({ code: "FORBIDDEN" }));
		// Public, its file is seen and downloaded as the note is.
		const response = await download(luisPhone, "probe.getNote", { id: 1 }, photo);
		expect(sha256(new Uint8Array(await response.arrayBuffer()))).toBe(sha256(JPEG));
		expect(test.invoke(luis, "probe.getNote", { id: 1 })?.files).toHaveLength(1);
	});

	it("answers NOT_FOUND to a file the read did not return, even one the person may see elsewhere", async () => {
		await using test = await household();
		const phone = await signedIn(test, "ana");
		const ana = test.contextOf(phone);
		test.invoke(ana, "probe.addNote", { body: "horno" }, { idempotencyKey: "n2" });
		const photo = attach(test, ana, 2, await prepare(phone));

		for (const [action, input, file] of [
			["probe.getNote", { id: 1 }, photo],
			["probe.getNote", { id: 2 }, "no-such-file"],
			["probe.countNotes", undefined, photo],
			["probe.attachFile", { noteId: 2, prepared: "x" }, photo],
			// A write is not a read whatever its input: no input it rejects answers first.
			["probe.attachFile", { noteId: "two" }, photo],
			["probe.nothing", undefined, photo],
		] as const) {
			const response = await download(phone, action, input, file);
			expect(response.status).toBe(404);
			expect(await response.json()).toMatchObject({ code: "NOT_FOUND" });
		}
		const searched = await download(phone, "probe.searchNotes", { text: "horno" }, photo);
		expect(searched.status).toBe(200);
		const listed = await download(phone, "probe.listNotes", undefined, photo);
		expect(listed.status).toBe(200);
		await listed.body?.cancel();
		await searched.body?.cancel();
	});

	it("answers the code of ctx.files for a prepared file that does not serve and a file not of the note", async () => {
		await using test = await household();
		const phone = await signedIn(test, "ana");
		const ana = test.contextOf(phone);
		const laptop = await signedIn(test, "ana");
		test.invoke(ana, "probe.addNote", { body: "horno" }, { idempotencyKey: "n2" });
		const attachIt =
			(context: VerifiedContext, prepared: string, noteId = 1) =>
			() =>
				test.invoke(
					context,
					"probe.attachFile",
					{ noteId, prepared },
					{ idempotencyKey: `try-${prepared}-${String(++keys)}` },
				);
		const used = await prepare(phone);
		const photo = attach(test, ana, 1, used);
		const fromLaptop = await prepare(laptop);
		const late = await prepare(phone);

		expect(attachIt(ana, used)).toThrow(
			expect.objectContaining({
				code: "CONFLICT",
				data: { reason: "prepared-file-consumed" },
			}),
		);
		expect(attachIt(ana, fromLaptop)).toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
		expect(attachIt(ana, "no-such-prepared-file")).toThrow(
			expect.objectContaining({ code: "NOT_FOUND" }),
		);
		expect(attachIt(ana, late, 9)).toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
		expect(() =>
			test.invoke(
				ana,
				"probe.detachFile",
				{ noteId: 2, file: photo },
				{ idempotencyKey: "d1" },
			),
		).toThrow(expect.objectContaining({ code: "NOT_FOUND", status: 404 }));

		test.clock.advance(24 * 60 * 60 * 1000 - 1);
		attach(test, test.contextOf(laptop), 2, fromLaptop);
		test.clock.advance(1);
		expect(attachIt(ana, late)).toThrow(
			expect.objectContaining({
				code: "CONFLICT",
				status: 409,
				data: { reason: "prepared-file-expired" },
			}),
		);
		expect(test.invoke(ana, "probe.listNotes").map((note) => note.files.length)).toEqual([
			1, 1,
		]);
	});

	it("gives a prepared file's place in the session's upload limit back once attaching uses it", async () => {
		await using test = await household();
		const phone = await signedIn(test, "ana");
		const ana = test.contextOf(phone);
		const prepared: string[] = [];
		for (let seed = 0; seed < 20; seed += 1)
			prepared.push(
				await prepare(phone, Uint8Array.of(...JPEG, seed), `${String(seed)}.jpg`),
			);
		const over = () =>
			phone.fetch(
				new Request(new URL("/api/files", TEST_ORIGIN), {
					method: "POST",
					body: Uint8Array.of(...JPEG, 20),
					headers: { "content-length": String(JPEG.length + 1), "x-file-name": "20.jpg" },
				}),
			);
		expect(await (await over()).json()).toMatchObject({ code: "UPLOAD_LIMIT" });

		attach(test, ana, 1, prepared[0] ?? "");

		expect((await over()).status).toBe(200);
	});

	it("does not attach a prepared file once its session ended", async () => {
		await using test = await household();
		const phone = await signedIn(test, "ana");
		const ana = test.contextOf(phone);
		const prepared = await prepare(phone);

		expect((await phone.signOut()).status).toBe(200);

		expect(() =>
			test.invoke(ana, "probe.attachFile", { noteId: 1, prepared }, { idempotencyKey: "a1" }),
		).toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
	});

	it("attaches a prepared file until its session expires, and not after though the session's row is still there", async () => {
		await using test = await household();
		const phone = await signedIn(test, "ana");
		const ana = test.contextOf(phone);
		const expiresAt = test.sessionExpiresAt(ana.session ?? "") ?? 0;
		test.clock.set(expiresAt - 60_000);
		const before = await prepare(phone);
		const after = await prepare(phone, Uint8Array.of(...JPEG, 1));

		test.clock.set(expiresAt - 1);
		attach(test, ana, 1, before);

		test.clock.set(expiresAt);
		expect(test.hasSession(ana.session ?? "")).toBe(true);
		expect(() =>
			test.invoke(
				ana,
				"probe.attachFile",
				{ noteId: 1, prepared: after },
				{ idempotencyKey: "a1" },
			),
		).toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
	});

	it("rolls an attachment back with a write that fails after it, and the prepared file serves again", async () => {
		failOnceAfter("attachFile");
		await using test = await household();
		const phone = await signedIn(test, "ana");
		const ana = test.contextOf(phone);
		const prepared = await prepare(phone);

		expect(() =>
			test.invoke(ana, "probe.attachFile", { noteId: 1, prepared }, { idempotencyKey: "a1" }),
		).toThrow(expect.objectContaining({ code: "INTERNAL_SERVER_ERROR" }));
		expect(test.invoke(ana, "probe.getNote", { id: 1 })?.files).toEqual([]);
		expect(test.log()).toHaveLength(1);

		const photo = attach(test, ana, 1, prepared);
		expect((await download(phone, "probe.getNote", { id: 1 }, photo)).status).toBe(200);
	});
});

describe("taking a file off and undoing", () => {
	it("rolls a detachment back with a write that fails after it, the note and its file as they were", async () => {
		failOnceAfter("detachFile");
		failOnceAfter("deleteNote");
		await using test = await household();
		const phone = await signedIn(test, "ana");
		const ana = test.contextOf(phone);
		const photo = attach(test, ana, 1, await prepare(phone));

		expect(() =>
			test.invoke(
				ana,
				"probe.detachFile",
				{ noteId: 1, file: photo },
				{ idempotencyKey: "d1" },
			),
		).toThrow(expect.objectContaining({ code: "INTERNAL_SERVER_ERROR" }));
		expect(() =>
			test.invoke(ana, "probe.deleteNote", { id: 1 }, { idempotencyKey: "d2" }),
		).toThrow(expect.objectContaining({ code: "INTERNAL_SERVER_ERROR" }));

		expect(test.invoke(ana, "probe.getNote", { id: 1 })).toMatchObject({
			body: "nevera",
			files: [{ id: photo }],
		});
		expect(await downloaded(phone, "probe.getNote", { id: 1 }, photo)).toBe(sha256(JPEG));
		const { entry } = written(
			test.invoke(ana, "probe.deleteNote", { id: 1 }, { idempotencyKey: "d3" }),
		);
		written(test.undo(ana, entry, { idempotencyKey: "u1" }));
		expect(await downloaded(phone, "probe.getNote", { id: 1 }, photo)).toBe(sha256(JPEG));
	});

	it("rolls an undo back when it fails after reattaching the file, and the next undo brings it", async () => {
		failOnceAfter("restoreNote");
		await using test = await household();
		const phone = await signedIn(test, "ana");
		const ana = test.contextOf(phone);
		const photo = attach(test, ana, 1, await prepare(phone));
		const { entry } = written(
			test.invoke(ana, "probe.deleteNote", { id: 1 }, { idempotencyKey: "d1" }),
		);

		expect(() => test.undo(ana, entry, { idempotencyKey: "u1" })).toThrow(
			expect.objectContaining({ code: "INTERNAL_SERVER_ERROR" }),
		);
		expect(test.invoke(ana, "probe.getNote", { id: 1 })).toBeNull();

		written(test.undo(ana, entry, { idempotencyKey: "u2" }));
		expect(test.invoke(ana, "probe.getNote", { id: 1 })).toMatchObject({
			files: [{ id: photo }],
		});
		expect(await downloaded(phone, "probe.getNote", { id: 1 }, photo)).toBe(sha256(JPEG));
	});
});

describe("undoing with files", () => {
	it("undoes attaching, detaching and deleting the note, and the photo downloads again", async () => {
		await using test = await household();
		const phone = await signedIn(test, "ana");
		const ana = test.contextOf(phone);
		const attached = written(
			test.invoke(
				ana,
				"probe.attachFile",
				{ noteId: 1, prepared: await prepare(phone) },
				{ idempotencyKey: "a1" },
			),
		);
		const photo = attached.result.id;
		expect(lastEntry(test)?.touched).toEqual([{ module: "probe", type: "note", id: "1" }]);

		written(test.undo(ana, attached.entry, { idempotencyKey: "u1" }));
		expect(test.invoke(ana, "probe.getNote", { id: 1 })?.files).toEqual([]);
		expect((await download(phone, "probe.getNote", { id: 1 }, photo)).status).toBe(404);

		const kept = attach(test, ana, 1, await prepare(phone, JPEG, "otra.jpg"));
		const detached = written(
			test.invoke(
				ana,
				"probe.detachFile",
				{ noteId: 1, file: kept },
				{ idempotencyKey: "d1" },
			),
		);
		expect(detached.result).toMatchObject({ id: kept, name: "otra.jpg" });
		expect(test.invoke(ana, "probe.getNote", { id: 1 })?.files).toEqual([]);
		written(test.undo(ana, detached.entry, { idempotencyKey: "u2" }));
		expect(await downloaded(phone, "probe.getNote", { id: 1 }, kept)).toBe(sha256(JPEG));

		const deleted = written(
			test.invoke(ana, "probe.deleteNote", { id: 1 }, { idempotencyKey: "d2" }),
		);
		expect(lastEntry(test)?.inverse).toEqual({
			action: "probe.restoreNote",
			input: { id: 1, body: "nevera", visibility: "private", files: [kept] },
		});
		expect((await download(phone, "probe.getNote", { id: 1 }, kept)).status).toBe(404);
		written(test.undo(ana, deleted.entry, { idempotencyKey: "u3" }));
		expect(test.invoke(ana, "probe.getNote", { id: 1 })).toEqual({
			id: 1,
			body: "nevera",
			files: [{ id: kept, name: "otra.jpg", type: "image/jpeg", size: JPEG.length }],
		});
		expect(await downloaded(phone, "probe.getNote", { id: 1 }, kept)).toBe(sha256(JPEG));
	});

	it("detaches, undoes, redoes and undoes the redo, each release linked to its own entry", async () => {
		await using test = await household();
		const phone = await signedIn(test, "ana");
		const ana = test.contextOf(phone);
		const photo = attach(test, ana, 1, await prepare(phone));

		const detached = written(
			test.invoke(
				ana,
				"probe.detachFile",
				{ noteId: 1, file: photo },
				{ idempotencyKey: "d1" },
			),
		);
		const undone = written(test.undo(ana, detached.entry, { idempotencyKey: "u1" }));
		const redone = written(test.undo(ana, undone.entry, { idempotencyKey: "u2" }));
		expect(test.invoke(ana, "probe.getNote", { id: 1 })?.files).toEqual([]);
		// Released again by the redo: the entry that first released it no longer reattaches it.
		expect(() =>
			test.invoke(
				ana,
				"probe.reattachFile",
				{ noteId: 1, file: photo },
				{ idempotencyKey: "r1" },
			),
		).toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
		written(test.undo(ana, redone.entry, { idempotencyKey: "u3" }));

		expect(await downloaded(phone, "probe.getNote", { id: 1 }, photo)).toBe(sha256(JPEG));
		expect(test.log().map(({ action, undoes }) => ({ action, undoes }))).toEqual([
			{ action: "probe.addNote", undoes: null },
			{ action: "probe.attachFile", undoes: null },
			{ action: "probe.detachFile", undoes: null },
			{ action: "probe.reattachFile", undoes: detached.entry },
			{ action: "probe.detachFile", undoes: undone.entry },
			{ action: "probe.reattachFile", undoes: redone.entry },
		]);
	});

	it("does not undo over a later change of the note's files, as over one of its text", async () => {
		await using test = await household();
		const phone = await signedIn(test, "ana");
		const ana = test.contextOf(phone);
		const changedSince = expect.objectContaining({
			code: "CONFLICT",
			data: { reason: "changed-since" },
		});

		const edited = written(
			test.invoke(
				ana,
				"probe.editNote",
				{ id: 1, body: "nevera rota" },
				{ idempotencyKey: "e1" },
			),
		);
		const photo = attach(test, ana, 1, await prepare(phone));
		expect(() => test.undo(ana, edited.entry, { idempotencyKey: "u1" })).toThrow(changedSince);

		const detached = written(
			test.invoke(
				ana,
				"probe.detachFile",
				{ noteId: 1, file: photo },
				{ idempotencyKey: "d1" },
			),
		);
		test.invoke(ana, "probe.editNote", { id: 1, body: "nevera" }, { idempotencyKey: "e2" });
		expect(() => test.undo(ana, detached.entry, { idempotencyKey: "u2" })).toThrow(
			changedSince,
		);
		expect(test.invoke(ana, "probe.getNote", { id: 1 })?.files).toEqual([]);
	});

	it("brings nothing back through reattachFile or restoreNote called directly", async () => {
		await using test = await household();
		const phone = await signedIn(test, "ana");
		const ana = test.contextOf(phone);
		const photo = attach(test, ana, 1, await prepare(phone));
		written(
			test.invoke(
				ana,
				"probe.detachFile",
				{ noteId: 1, file: photo },
				{ idempotencyKey: "d1" },
			),
		);
		test.invoke(ana, "probe.addNote", { body: "horno" }, { idempotencyKey: "n2" });
		const other = attach(test, ana, 2, await prepare(phone));
		written(test.invoke(ana, "probe.deleteNote", { id: 2 }, { idempotencyKey: "d2" }));

		expect(() =>
			test.invoke(
				ana,
				"probe.reattachFile",
				{ noteId: 1, file: photo },
				{ idempotencyKey: "r1" },
			),
		).toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
		expect(() =>
			test.invoke(
				ana,
				"probe.restoreNote",
				{ id: 2, body: "horno", visibility: "private", files: [other] },
				{ idempotencyKey: "r2" },
			),
		).toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
		expect(test.invoke(ana, "probe.listNotes")).toEqual([{ id: 1, body: "nevera", files: [] }]);
	});
});

describe("the protection of a released file", () => {
	/** A database and a folder of contents kept across opening the platform again. */
	function dataFolder(): { readonly file: string; readonly files: string } & AsyncDisposable {
		const path = mkdtempSync(join(tmpdir(), "domus-probe-files-"));
		return {
			file: join(path, "domus.db"),
			files: join(path, "files"),
			[Symbol.asyncDispose]: async () => {
				rmSync(path, { recursive: true, force: true });
			},
		};
	}

	/** Opens probe on `data` with `retention`, Ana signed in. */
	async function openOn(data: { file: string; files: string }, retention: number) {
		const test = createTestPlatform({ modules: [probe], ...data, retention, freeSpace: ROOMY });
		const phone = test.browser();
		expect((await phone.signIn("ana@domus.test", PASSWORD)).status).toBe(200);
		return { test, phone };
	}

	/** Deletes on `data`, with `retention`, a note of Ana's with a photo: the photo's id and the deletion's entry. */
	async function deletedWithPhoto(data: { file: string; files: string }, retention: number) {
		const test = createTestPlatform({ modules: [probe], ...data, retention, freeSpace: ROOMY });
		await using _ = test;
		test.prepare.account({ id: "ana", role: "member" });
		await test.prepare.password("ana", PASSWORD);
		const phone = await signedIn(test, "ana");
		const ana = test.contextOf(phone);
		test.invoke(ana, "probe.addNote", { body: "nevera" }, { idempotencyKey: "n1" });
		const photo = attach(test, ana, 1, await prepare(phone));
		const { entry } = written(
			test.invoke(ana, "probe.deleteNote", { id: 1 }, { idempotencyKey: "d1" }),
		);
		return { photo, deletion: entry };
	}

	it("keeps the instant fixed when the file was released, whatever the retention later says", async () => {
		await using short = dataFolder();
		const shortly = await deletedWithPhoto(short, 1 * DAY);
		{
			const { test } = await openOn(short, 30 * DAY);
			await using _ = test;
			test.clock.advance(2 * DAY);
			expect(() =>
				test.undo(test.context("ana"), shortly.deletion, { idempotencyKey: "u1" }),
			).toThrow(expect.objectContaining({ data: { reason: "expired" } }));
		}

		await using long = dataFolder();
		const { photo, deletion } = await deletedWithPhoto(long, 30 * DAY);
		const { test, phone } = await openOn(long, 1 * DAY);
		await using _ = test;
		test.clock.advance(2 * DAY);
		written(test.undo(test.context("ana"), deletion, { idempotencyKey: "u1" }));
		expect(await downloaded(phone, "probe.getNote", { id: 1 }, photo)).toBe(sha256(JPEG));
	});
});

describe("downloading", () => {
	/** How many descriptors this process has open. */
	const openDescriptors = () => readdirSync("/dev/fd").length;

	it("leaves no descriptor open when its read fails, or once its bytes are sent or given up", async () => {
		await using test = await household();
		const phone = await signedIn(test, "ana");
		const ana = test.contextOf(phone);
		const photo = attach(test, ana, 1, await prepare(phone));
		const before = openDescriptors();

		expect((await download(phone, "probe.getNote", { id: 9 }, photo)).status).toBe(404);
		expect((await download(phone, "probe.getNote", { id: 1 }, "other")).status).toBe(404);
		test.prepare.grant("ana", "probe", "none");
		expect((await download(phone, "probe.getNote", { id: 1 }, photo)).status).toBe(403);
		test.prepare.grant("ana", "probe", "write");
		expect(openDescriptors()).toBe(before);

		const sent = await download(phone, "probe.getNote", { id: 1 }, photo);
		expect(openDescriptors()).toBe(before + 1);
		await sent.arrayBuffer();
		expect(openDescriptors()).toBe(before);

		const givenUp = await download(phone, "probe.getNote", { id: 1 }, photo);
		await givenUp.body?.cancel();
		expect(openDescriptors()).toBe(before);
	});

	it("answers a bad request to a body that is not a download, and UNAUTHORIZED without a session", async () => {
		await using test = await household();
		const phone = await signedIn(test, "ana");
		const ana = test.contextOf(phone);
		const photo = attach(test, ana, 1, await prepare(phone));

		for (const body of ['{"action":"probe.getNote"}', "[]", "not json", '{"confirmation":1}'])
			expect(
				(
					await phone.fetch(
						new Request(new URL("/api/files/download", TEST_ORIGIN), {
							method: "POST",
							headers: { "content-type": "application/json" },
							body,
						}),
					)
				).status,
			).toBe(400);
		expect((await download(phone, "probe.getNote", { id: "1" }, photo)).status).toBe(400);
		const anonymous = await download(test.browser(), "probe.getNote", { id: 1 }, photo);
		expect(anonymous.status).toBe(401);
		expect(await anonymous.json()).toMatchObject({ code: "UNAUTHORIZED" });
	});
});

describe("a confirmed download", () => {
	/** Confirms the pending download `confirmation` from `browser`, through the download's own route. */
	function confirmDownload(browser: TestBrowser, confirmation: string): Promise<Response> {
		return browser.fetch(
			new Request(new URL("/api/files/download", TEST_ORIGIN), {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ confirmation }),
			}),
		);
	}

	/** Asks for `file` through `getGuardedNote`, which always asks first, and returns the pending download's id. */
	async function askToDownload(browser: TestBrowser, file: string): Promise<string> {
		const response = await download(browser, "probe.getGuardedNote", { id: 1 }, file);
		expect(response.status).toBe(428);
		const body = (await response.json()) as { code: string; data: { confirmation: string } };
		expect(body.code).toBe("CONFIRMATION_REQUIRED");
		return body.data.confirmation;
	}

	/** The error a call throws. */
	function thrown(call: () => unknown): unknown {
		try {
			call();
		} catch (error) {
			return error;
		}
		throw new Error("it did not throw");
	}

	it("waits as a pending download of its own, apart from the same read asked as a read", async () => {
		await using test = await household();
		const phone = await signedIn(test, "ana");
		const ana = test.contextOf(phone);
		const photo = attach(test, ana, 1, await prepare(phone));

		const pending = await askToDownload(phone, photo);
		expect(await askToDownload(phone, photo)).toBe(pending);

		const read = thrown(() => test.invoke(ana, "probe.getGuardedNote", { id: 1 }));
		expect(read).toMatchObject({ code: "CONFIRMATION_REQUIRED" });
		const asRead = (read as { data: { confirmation: string } }).data.confirmation;
		expect(asRead).not.toBe(pending);
		expect(test.confirm(ana, asRead)).toMatchObject({ id: 1, files: [{ id: photo }] });
	});

	it("gives the bytes once confirmed from another session of the same person, and is not found by another", async () => {
		await using test = await household();
		const phone = await signedIn(test, "ana");
		const laptop = await signedIn(test, "ana");
		const photo = attach(test, test.contextOf(phone), 1, await prepare(phone));
		const pending = await askToDownload(phone, photo);

		const luis = await confirmDownload(await signedIn(test, "luis"), pending);
		expect(luis.status).toBe(404);
		expect(await luis.json()).toMatchObject({ code: "NOT_FOUND" });
		expect((await confirmDownload(test.browser(), pending)).status).toBe(401);

		const response = await confirmDownload(laptop, pending);
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe("image/jpeg");
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(sha256(new Uint8Array(await response.arrayBuffer()))).toBe(sha256(JPEG));
	});

	it("gives the bytes once: the second confirmation is a conflict, also when the first answer was lost", async () => {
		await using test = await household();
		const phone = await signedIn(test, "ana");
		const photo = attach(test, test.contextOf(phone), 1, await prepare(phone));
		const pending = await askToDownload(phone, photo);

		// The first answer never reaches the person: its body is given up unread.
		const lost = await confirmDownload(phone, pending);
		expect(lost.status).toBe(200);
		await lost.body?.cancel();

		const again = await confirmDownload(phone, pending);
		expect(again.status).toBe(409);
		expect(await again.json()).toMatchObject(consumed);
	});

	it("does not give the bytes of one that expired or was rejected", async () => {
		await using test = await household();
		const phone = await signedIn(test, "ana");
		const ana = test.contextOf(phone);
		const photo = attach(test, ana, 1, await prepare(phone));

		const rejected = await askToDownload(phone, photo);
		test.reject(ana, rejected);
		const afterRejecting = await confirmDownload(phone, rejected);
		expect(afterRejecting.status).toBe(409);
		expect(await afterRejecting.json()).toMatchObject(consumed);

		const expiring = await askToDownload(phone, photo);
		test.clock.advance(DAY);
		const afterExpiring = await confirmDownload(phone, expiring);
		expect(afterExpiring.status).toBe(409);
		expect(await afterExpiring.json()).toMatchObject({
			code: "CONFLICT",
			data: { reason: "confirmation-expired" },
		});
	});

	it("is refused by the generic confirm without consuming it, and still confirms through its route", async () => {
		await using test = await household();
		const phone = await signedIn(test, "ana");
		const ana = test.contextOf(phone);
		const photo = attach(test, ana, 1, await prepare(phone));
		const pending = await askToDownload(phone, photo);

		expect(thrown(() => test.confirm(ana, pending))).toMatchObject({
			code: "CONFLICT",
			status: 409,
			data: { reason: "confirm-by-download" },
		});

		expect(await downloadedOnConfirming(phone, pending)).toBe(sha256(JPEG));
	});

	it("is not found through the download's route for a pending operation that is not a download", async () => {
		await using test = await household();
		const phone = await signedIn(test, "ana");
		const ana = test.contextOf(phone);
		const read = thrown(() => test.invoke(ana, "probe.getGuardedNote", { id: 1 }));
		const pending = (read as { data: { confirmation: string } }).data.confirmation;

		const response = await confirmDownload(phone, pending);
		expect(response.status).toBe(404);
		expect(test.confirm(ana, pending)).toMatchObject({ id: 1 });
	});

	it("gives no bytes when the permission or the file went between asking and confirming", async () => {
		await using test = await household();
		const phone = await signedIn(test, "ana");
		const ana = test.contextOf(phone);
		const photo = attach(test, ana, 1, await prepare(phone));

		const withoutPermission = await askToDownload(phone, photo);
		test.prepare.grant("ana", "probe", "none");
		expect((await confirmDownload(phone, withoutPermission)).status).toBe(403);
		test.prepare.grant("ana", "probe", "write");

		const withoutFile = await askToDownload(phone, photo);
		test.invoke(
			ana,
			"probe.detachFile",
			{ noteId: 1, file: photo },
			{ idempotencyKey: "detach" },
		);
		expect((await confirmDownload(phone, withoutFile)).status).toBe(404);

		// Neither was consumed: once the file is back, the one that waited for it gives it.
		test.undo(ana, lastEntry(test)?.entry ?? 0, { idempotencyKey: "undo-detach" });
		expect(await downloadedOnConfirming(phone, withoutFile)).toBe(sha256(JPEG));
	});

	const consumed = { code: "CONFLICT", data: { reason: "confirmation-consumed" } };

	/** The SHA-256 of what confirming a pending download answers, once it answered 200. */
	async function downloadedOnConfirming(
		browser: TestBrowser,
		confirmation: string,
	): Promise<string> {
		const response = await confirmDownload(browser, confirmation);
		expect(response.status).toBe(200);
		return sha256(new Uint8Array(await response.arrayBuffer()));
	}
});

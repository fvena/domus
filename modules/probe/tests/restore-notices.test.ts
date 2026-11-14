import { randomBytes } from "node:crypto";
// Restoring leaves nothing old that could go out (spec of phase 1d4, «Restaurar» and seam 4 of «Decisiones de
// prueba», ADR 0029), with the real restic: a backup taken while a notice and its deliveries wait, restored with the
// platform closed. Every session ends, and its subscription with it; the notices and deliveries of the copy are
// cancelled and never reach the push service after starting; the VAPID keys are the copy's.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	createTestPlatform,
	fakePushService,
	type FakePushService,
	type InterleavePoint,
	pushClient,
	restoreBackup,
	TEST_ORIGIN,
	type TestBackups,
	type TestBrowser,
	type TestPlatform,
	type VerifiedContext,
} from "@domus/test-utils";
import { describe, expect, it, vi } from "vitest";

import probe from "../server";

type Probe = TestPlatform<readonly [typeof probe]>;

const PASSWORD = "correct horse battery staple";
/** 05:00 in Madrid on the first day of the test clock, when the first backup is due. */
const FIRST_BACKUP = Date.parse("2026-01-01T04:00:00Z");
/** A while after the backup. */
const AFTER_BACKUP = FIRST_BACKUP + 60 * 60 * 1000;
/** restic derives its key on every open of the repository, which takes about a second each time. */
const RESTIC_TIMEOUT = 60_000;

/** A temporary data folder, an empty repository folder and a password file, removed at the end of a `using` block. */
function restoreTarget() {
	const dir = mkdtempSync(join(tmpdir(), "domus-probe-restore-notices-"));
	const data = join(dir, "data");
	mkdirSync(data);
	const repository = join(dir, "repository");
	mkdirSync(repository);
	const passwordFile = join(dir, "password");
	writeFileSync(passwordFile, randomBytes(24).toString("hex"), { mode: 0o600 });
	const backups: TestBackups = { repository, passwordFile };
	return {
		file: join(data, "domus.db"),
		files: join(data, "files"),
		backups,
		[Symbol.dispose]: () => rmSync(dir, { recursive: true, force: true }),
	};
}
type RestoreTarget = ReturnType<typeof restoreTarget>;

/** Probe on the target's data folder, with the backups on and a fake push service. */
function open(
	target: RestoreTarget,
	push: FakePushService,
	interleave?: (point: InterleavePoint) => Promise<void> | void,
): Probe {
	return createTestPlatform({
		modules: [probe],
		file: target.file,
		files: target.files,
		backups: target.backups,
		push,
		...(interleave === undefined ? {} : { interleave }),
	});
}

async function signedIn(test: Probe, who: string): Promise<TestBrowser> {
	const browser = test.browser();
	expect((await browser.signIn(`${who}@domus.test`, PASSWORD)).status).toBe(200);
	return browser;
}

/** Subscribes the browser's device with a client of the fake service, through the door. */
async function subscribed(browser: TestBrowser, name: string): Promise<void> {
	const client = pushClient(name);
	const response = await browser.fetch(
		new Request(new URL("/api/notifications/subscription", TEST_ORIGIN), {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ endpoint: client.endpoint, keys: client.keys }),
		}),
	);
	expect(response.status).toBe(200);
}

/** The public VAPID key the door serves. */
async function publicKey(browser: TestBrowser): Promise<string> {
	const response = await browser.fetch(
		new Request(new URL("/api/notifications/key", TEST_ORIGIN)),
	);
	return ((await response.json()) as { key: string }).key;
}

let keys = 0;
/** A public note of Rocío's that tells Paco. */
function noteFor(test: Probe, rocio: VerifiedContext): void {
	const added = test.invoke(
		rocio,
		"probe.addNote",
		{ body: "comprar pan", notify: ["paco"] },
		{ idempotencyKey: `k${String(++keys)}` },
	);
	if (!("result" in added)) throw new Error("expected the write's result");
	test.invoke(
		rocio,
		"probe.setNoteVisibility",
		{ id: added.result.id, visibility: "public" },
		{ idempotencyKey: `k${String(++keys)}` },
	);
}

/** The state of each job of the notices, by kind, oldest first. */
function noticeJobs(test: Probe) {
	return test.background
		.jobs()
		.filter((job) => job.kind === "notice" || job.kind === "delivery")
		.map(({ kind, state, error }) => ({ kind, state, error }));
}

/** A promise and what settles it. */
function resolvable(): { readonly promise: Promise<void>; readonly resolve: () => void } {
	let resolve = () => undefined as void;
	const promise = new Promise<void>((settle) => {
		resolve = settle;
	});
	return { promise, resolve: () => resolve() };
}

describe("restoring a backup taken with notices waiting", { timeout: RESTIC_TIMEOUT }, () => {
	it("leaves no subscription, cancels its notices and deliveries, which never go out, and keeps its VAPID key", async () => {
		using target = restoreTarget();
		let key: string;
		{
			// The first delivery waits right before its check, holding the short lane: the other delivery and a
			// second notice wait behind it while the backup runs in the maintenance lane.
			const reached = resolvable();
			const released = resolvable();
			let holding = true;
			await using test = open(target, fakePushService(), (point) => {
				if (point !== "delivering" || !holding) return;
				holding = false;
				reached.resolve();
				return released.promise;
			});
			for (const id of ["paco", "rocio"]) {
				test.prepare.account({ id, role: "member" });
				await test.prepare.password(id, PASSWORD);
			}
			const phone = await signedIn(test, "paco");
			await subscribed(phone, "paco-phone");
			await subscribed(await signedIn(test, "paco"), "paco-laptop");
			key = await publicKey(phone);
			const rocio = test.context("rocio");
			test.background.start();
			noteFor(test, rocio);
			await reached.promise;
			noteFor(test, rocio);
			expect(noticeJobs(test)).toEqual([
				{ kind: "notice", state: "done", error: null },
				{ kind: "delivery", state: "running", error: null },
				{ kind: "delivery", state: "pending", error: null },
				{ kind: "notice", state: "pending", error: null },
			]);

			test.clock.set(FIRST_BACKUP);
			await vi.waitFor(
				() => {
					const runs = test.background.runs().filter((run) => run.task === "backup");
					expect(runs[runs.length - 1]).toEqual(
						expect.objectContaining({ result: "ok" }),
					);
				},
				{ timeout: RESTIC_TIMEOUT / 2, interval: 50 },
			);
			released.resolve();
		}

		await restoreBackup({
			file: target.file,
			files: target.files,
			modules: [probe],
			backups: target.backups,
			at: AFTER_BACKUP,
		});

		const push = fakePushService();
		await using test = open(target, push);
		expect(test.subscriptions()).toEqual([]);
		test.background.start();
		await test.background.runDue();
		await test.background.settled();

		const discarded = { state: "cancelled", error: "discarded by restore" };
		expect(noticeJobs(test)).toEqual([
			{ kind: "notice", state: "done", error: null },
			{ kind: "delivery", ...discarded },
			{ kind: "delivery", ...discarded },
			{ kind: "notice", ...discarded },
		]);
		expect(push.requests).toEqual([]);
		expect(await publicKey(await signedIn(test, "paco"))).toBe(key);
	});
});

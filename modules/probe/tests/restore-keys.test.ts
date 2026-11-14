// Restoring leaves no credential of a connected app (spec of phase 1e, «Restaurar», ADR 0030, ADR 0026), with the
// real restic: every key that was live in the copy comes back revoked at the instant of restoring, one revoked
// before keeps its instant, one created after the copy does not exist, and no mandate of before is good. A key
// created after restoring works with a new mandate.
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { clientFor } from "@domus/api-client";
import {
	createTestPlatform,
	platformContract,
	restoreBackup,
	TEST_ORIGIN,
	TEST_START,
	type TestBackups,
	type TestBrowser,
	type TestPlatform,
} from "@domus/test-utils";
import { describe, expect, it, vi } from "vitest";

import { probeContract } from "../contracts";
import probe from "../server";

type Probe = TestPlatform<readonly [typeof probe]>;

const PASSWORD = "correct horse battery staple";
/** 05:00 in Madrid on the first day of the test clock, when the first backup is due. */
const FIRST_BACKUP = Date.parse("2026-01-01T04:00:00Z");
/** A while after the backup. */
const AFTER_BACKUP = FIRST_BACKUP + 60 * 60 * 1000;
/** restic derives its key on every open of the repository, which takes about a second each time. */
const RESTIC_TIMEOUT = 60_000;

const contract = { ...platformContract, probe: probeContract };

/** A temporary data folder, an empty repository folder and a password file, removed at the end of a `using` block. */
function restoreTarget() {
	const dir = mkdtempSync(join(tmpdir(), "domus-probe-restore-keys-"));
	const data = join(dir, "data");
	mkdirSync(data);
	const repository = join(dir, "repository");
	mkdirSync(repository);
	const passwordFile = join(dir, "password");
	writeFileSync(passwordFile, randomBytes(24).toString("hex"), { mode: 0o600 });
	const backups: TestBackups = { repository, passwordFile };
	return {
		file: join(data, "domus.db"),
		backups,
		[Symbol.dispose]: () => rmSync(dir, { recursive: true, force: true }),
	};
}
type RestoreTarget = ReturnType<typeof restoreTarget>;

/**
 * Probe on the target's data folder, with the backups on, and mandates good for a day: a mandate in the copy would
 * still be good at the instant of restoring, but for the restore.
 */
function open(target: RestoreTarget): Probe {
	return createTestPlatform({
		modules: [probe],
		file: target.file,
		backups: target.backups,
		mandateLife: 24 * 60 * 60 * 1000,
	});
}

async function signedIn(test: Probe, who: string): Promise<TestBrowser> {
	const browser = test.browser();
	expect((await browser.signIn(`${who}@domus.test`, PASSWORD)).status).toBe(200);
	return browser;
}

/** What `status` and Kira's read with `key` and `mandate` answer: `"ok"` or the code of the error. */
async function answersTo(test: Probe, key: string, mandate: string) {
	const outcome = async (call: () => Promise<unknown>) => {
		try {
			await call();
			return "ok";
		} catch (error) {
			return String((error as { code?: unknown }).code);
		}
	};
	const kira = clientFor(contract, {
		baseUrl: TEST_ORIGIN,
		fetch: test.door.fetch,
		headers: { authorization: `Bearer ${key}`, "domus-mandate": mandate },
	});
	return {
		status: await outcome(() => kira.status()),
		read: await outcome(() => kira.probe.listNotes()),
	};
}

/** The id of a key, `domus_<id>.<secret>`. */
const idOf = (key: string) => key.slice("domus_".length, key.indexOf("."));

describe("restoring a backup", { timeout: RESTIC_TIMEOUT }, () => {
	it("revokes every key of before at its instant, keeps none created after the copy, and no mandate of before is good", async () => {
		using target = restoreTarget();
		let live: string;
		let revoked: string;
		let later: string;
		let mandate: string;
		{
			await using test = open(target);
			test.prepare.account({ id: "ana", role: "member" });
			await test.prepare.password("ana", PASSWORD);
			live = test.prepare.key("kira");
			revoked = test.prepare.key("kira");
			test.revokeKey(idOf(revoked));
			mandate = test.mandate(await signedIn(test, "ana"));
			expect(await answersTo(test, live, mandate)).toEqual({ status: "ok", read: "ok" });
			test.background.start();
			test.clock.set(FIRST_BACKUP);
			await vi.waitFor(
				() =>
					expect(test.background.runs()).toContainEqual(
						expect.objectContaining({ task: "backup", result: "ok" }),
					),
				{ timeout: RESTIC_TIMEOUT / 2, interval: 50 },
			);
			later = test.prepare.key("kira");
			expect(await answersTo(test, later, mandate)).toEqual({ status: "ok", read: "ok" });
		}

		await restoreBackup({
			file: target.file,
			modules: [probe],
			backups: target.backups,
			at: AFTER_BACKUP,
		});

		await using test = open(target);
		test.clock.set(AFTER_BACKUP, { wake: false });
		for (const key of [live, revoked, later])
			expect(await answersTo(test, key, mandate)).toEqual({
				status: "UNAUTHORIZED",
				read: "UNAUTHORIZED",
			});
		expect(test.keys()).toEqual([
			expect.objectContaining({ id: idOf(live), revokedAt: AFTER_BACKUP }),
			expect.objectContaining({ id: idOf(revoked), revokedAt: TEST_START }),
		]);

		const fresh = test.prepare.key("kira");
		expect(await answersTo(test, fresh, mandate)).toEqual({
			status: "ok",
			read: "UNAUTHORIZED",
		});
		expect(await answersTo(test, fresh, test.mandate(await signedIn(test, "ana")))).toEqual({
			status: "ok",
			read: "ok",
		});
	});
});

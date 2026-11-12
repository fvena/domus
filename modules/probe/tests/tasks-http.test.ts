// The settings of the scheduled tasks over HTTP (ADR 0025): operations of the platform's area served by the door,
// with real sessions. Listing is a read without a proof; changing the time, pausing, resuming and launching are
// `manage` writes, each with its step-up proof, its idempotency key and its entry in the action log.
import { clientFor } from "@domus/api-client";
import {
	createTestPlatform,
	platformContract,
	TEST_ORIGIN,
	type TestBrowser,
} from "@domus/test-utils";
import { describe, expect, it } from "vitest";

import { probeContract } from "../contracts";
import probe from "../server";

const PASSWORD = "correct horse battery staple";
const at = (iso: string) => Date.parse(iso);

/** A platform with probe and its background started; Paco, the admin, and Ana, a member, with a password. */
async function household() {
	const test = createTestPlatform({ modules: [probe] });
	test.prepare.account({ id: "paco", role: "admin" });
	test.prepare.account({ id: "ana", role: "member" });
	for (const id of ["paco", "ana"]) await test.prepare.password(id, PASSWORD);
	test.background.start();
	return test;
}

function clientOf(browser: TestBrowser) {
	return clientFor(
		{ ...platformContract, probe: probeContract },
		{ baseUrl: TEST_ORIGIN, fetch: browser.fetch },
	);
}

async function signedIn(test: { browser(): TestBrowser }, who: string) {
	const browser = test.browser();
	expect((await browser.signIn(`${who}@domus.test`, PASSWORD)).status).toBe(200);
	return clientOf(browser);
}

describe("listing the scheduled tasks over HTTP", () => {
	it("answers the admin and a member without a proof, and nobody without a session", async () => {
		await using test = await household();
		const cleanup = {
			id: "cleanup",
			frequency: { every: "day", at: "04:30" },
			paused: false,
			// The test starts at 01:00 in Madrid (CET, +01:00).
			nextAt: at("2026-01-01T03:30:00Z"),
			lastRun: null,
			stuck: false,
		};

		expect(await (await signedIn(test, "paco")).tasks.list()).toEqual([cleanup]);
		expect(await (await signedIn(test, "ana")).tasks.list()).toEqual([cleanup]);
		await expect(clientOf(test.browser()).tasks.list()).rejects.toMatchObject({
			code: "UNAUTHORIZED",
		});
	});
});

type Client = Awaited<ReturnType<typeof signedIn>>;

/** A proof for `client` of `platform.<name>` with `input`. */
async function proofOf(client: Client, name: string, input: unknown): Promise<string> {
	return (
		await client.proofs.request({
			password: PASSWORD,
			operation: { action: `platform.${name}`, input },
		})
	).proof;
}

const cleanup = { task: "cleanup" };

describe("changing the scheduled tasks over HTTP", () => {
	it("lets the admin change the time, pause, resume and launch, each with a proof of it, and logs each", async () => {
		await using test = await household();
		const paco = await signedIn(test, "paco");
		const sixAm = { task: "cleanup", time: "06:00" };

		expect(
			await paco.tasks.setTime(sixAm, {
				context: { idempotencyKey: "t1", proof: await proofOf(paco, "setTaskTime", sixAm) },
			}),
		).toEqual({ result: sixAm, entry: 1 });
		expect(await paco.tasks.list()).toMatchObject([
			{ frequency: { every: "day", at: "06:00" }, nextAt: at("2026-01-01T05:00:00Z") },
		]);

		expect(
			await paco.tasks.pause(cleanup, {
				context: { idempotencyKey: "t2", proof: await proofOf(paco, "pauseTask", cleanup) },
			}),
		).toEqual({ result: { task: "cleanup", paused: true }, entry: 2 });
		expect(await paco.tasks.list()).toMatchObject([{ paused: true }]);

		expect(
			await paco.tasks.resume(cleanup, {
				context: {
					idempotencyKey: "t3",
					proof: await proofOf(paco, "resumeTask", cleanup),
				},
			}),
		).toEqual({ result: { task: "cleanup", paused: false }, entry: 3 });
		expect(await paco.tasks.list()).toMatchObject([{ paused: false }]);

		expect(
			await paco.tasks.launch(cleanup, {
				context: {
					idempotencyKey: "t4",
					proof: await proofOf(paco, "launchTask", cleanup),
				},
			}),
		).toEqual({ result: { task: "cleanup", run: 1 }, entry: 4 });

		expect((await paco.log.read()).map(({ action }) => action)).toEqual([
			"platform.setTaskTime",
			"platform.pauseTask",
			"platform.resumeTask",
			"platform.launchTask",
		]);
	});

	it("asks the admin for the proof again without one or with another operation's", async () => {
		await using test = await household();
		const paco = await signedIn(test, "paco");
		const stepUp = { code: "STEP_UP_REQUIRED", status: 403 };
		const otherProof = await proofOf(paco, "pauseTask", cleanup);

		await expect(
			paco.tasks.launch(cleanup, { context: { idempotencyKey: "t1" } }),
		).rejects.toMatchObject(stepUp);
		await expect(
			paco.tasks.launch(cleanup, { context: { idempotencyKey: "t1", proof: otherProof } }),
		).rejects.toMatchObject(stepUp);
		await expect(
			paco.tasks.setTime(
				{ task: "cleanup", time: "05:00" },
				{ context: { idempotencyKey: "t2", proof: otherProof } },
			),
		).rejects.toMatchObject(stepUp);
		expect(await paco.log.read()).toEqual([]);
	});

	it("answers a member not allowed, even with a proof, and nobody without a session", async () => {
		await using test = await household();
		const ana = await signedIn(test, "ana");
		const anonymous = clientOf(test.browser());

		await expect(
			ana.tasks.pause(cleanup, {
				context: { idempotencyKey: "t1", proof: await proofOf(ana, "pauseTask", cleanup) },
			}),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		await expect(
			ana.tasks.setTime(
				{ task: "cleanup", time: "05:00" },
				{ context: { idempotencyKey: "t2" } },
			),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		await expect(
			anonymous.tasks.launch(cleanup, { context: { idempotencyKey: "t3" } }),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });
		expect(await ana.tasks.list()).toMatchObject([{ paused: false, lastRun: null }]);
	});

	it("answers the acknowledgement to a repeat under the same key, without changing anything again", async () => {
		await using test = await household();
		const paco = await signedIn(test, "paco");
		const proof = await proofOf(paco, "launchTask", cleanup);
		await paco.tasks.launch(cleanup, { context: { idempotencyKey: "t1", proof } });
		await test.background.settled();

		expect(
			await paco.tasks.launch(cleanup, { context: { idempotencyKey: "t1", proof } }),
		).toEqual({ entry: 1, repeated: true });
		await test.background.runDue();
		expect(test.background.runs()).toHaveLength(1);
	});

	it("undoes a change of time and a pause, which the list shows as before", async () => {
		await using test = await household();
		const paco = await signedIn(test, "paco");
		const sixAm = { task: "cleanup", time: "06:00" };
		const before = await paco.tasks.list();
		await paco.tasks.setTime(sixAm, {
			context: { idempotencyKey: "t1", proof: await proofOf(paco, "setTaskTime", sixAm) },
		});
		await paco.tasks.pause(cleanup, {
			context: { idempotencyKey: "t2", proof: await proofOf(paco, "pauseTask", cleanup) },
		});
		/** Undoes `entry` with a proof of that undo. */
		const undo = async (entry: number, idempotencyKey: string) => {
			const { proof } = await paco.proofs.request({
				password: PASSWORD,
				operation: { undo: entry },
			});
			return paco.log.undo({ entry }, { context: { idempotencyKey, proof } });
		};

		expect(await undo(2, "u1")).toEqual({
			result: { task: "cleanup", paused: false },
			entry: 3,
		});
		expect(await paco.tasks.list()).toMatchObject([
			{ paused: false, frequency: { at: "06:00" } },
		]);
		expect(await undo(1, "u2")).toEqual({ result: { task: "cleanup", time: null }, entry: 4 });
		expect(await paco.tasks.list()).toEqual(before);
	});

	it("does not undo a launch", async () => {
		await using test = await household();
		const paco = await signedIn(test, "paco");
		await paco.tasks.launch(cleanup, {
			context: { idempotencyKey: "t1", proof: await proofOf(paco, "launchTask", cleanup) },
		});

		await expect(
			paco.log.undo({ entry: 1 }, { context: { idempotencyKey: "u1" } }),
		).rejects.toMatchObject({
			code: "UNPROCESSABLE_CONTENT",
			data: { reason: "irreversible" },
		});
	});

	it("answers not found for a task the code does not declare, once authorized and proven", async () => {
		await using test = await household();
		const paco = await signedIn(test, "paco");
		const unknown = { task: "backup" };
		const backupAtFive = { ...unknown, time: "05:00" };

		await expect(
			paco.tasks.launch(unknown, { context: { idempotencyKey: "t1" } }),
		).rejects.toMatchObject({ code: "STEP_UP_REQUIRED" });
		await expect(
			paco.tasks.launch(unknown, {
				context: {
					idempotencyKey: "t2",
					proof: await proofOf(paco, "launchTask", unknown),
				},
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		await expect(
			paco.tasks.setTime(backupAtFive, {
				context: {
					idempotencyKey: "t3",
					proof: await proofOf(paco, "setTaskTime", backupAtFive),
				},
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		await expect(
			paco.tasks.pause(unknown, {
				context: { idempotencyKey: "t4", proof: await proofOf(paco, "pauseTask", unknown) },
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		await expect(
			paco.tasks.resume(unknown, {
				context: {
					idempotencyKey: "t5",
					proof: await proofOf(paco, "resumeTask", unknown),
				},
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		expect(await paco.log.read()).toEqual([]);
	});

	it("answers a member not allowed whether the task exists or not", async () => {
		await using test = await household();
		const ana = await signedIn(test, "ana");
		const unknown = { task: "backup" };

		await expect(
			ana.tasks.launch(unknown, { context: { idempotencyKey: "t1" } }),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		await expect(
			ana.tasks.pause(unknown, {
				context: { idempotencyKey: "t2", proof: await proofOf(ana, "pauseTask", unknown) },
			}),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
	});
});

/** A task of the test, every day at 03:00, whose job runs until the test ends it and ignores its cancellation. */
function heldTask() {
	let release = () => {};
	let fail = (_error: Error) => {};
	return {
		task: {
			id: "held",
			frequency: { every: "day", at: "03:00" },
			job: {
				lane: "maintenance",
				timeout: 60 * 1000,
				run: () =>
					new Promise<void>((resolve, reject) => {
						release = resolve;
						fail = reject;
					}),
			},
		} as const,
		release: () => release(),
		fail: (error: Error) => fail(error),
	};
}

describe("launching a task over HTTP", () => {
	it("runs a manual run that the log of runs and the list show, and answers a conflict while it is pending or running", async () => {
		const held = heldTask();
		await using test = createTestPlatform({ modules: [probe], tasks: [held.task] });
		test.prepare.account({ id: "paco", role: "admin" });
		await test.prepare.password("paco", PASSWORD);
		test.background.start();
		const paco = await signedIn(test, "paco");
		const launch = async (idempotencyKey: string) =>
			paco.tasks.launch(
				{ task: "held" },
				{
					context: {
						idempotencyKey,
						proof: await proofOf(paco, "launchTask", { task: "held" }),
					},
				},
			);
		const busy = { code: "CONFLICT", data: { reason: "task-busy" } };

		expect(await launch("t1")).toMatchObject({ result: { task: "held", run: 1 } });
		await expect(launch("t2")).rejects.toMatchObject(busy);
		await test.background.flush();
		expect(test.background.jobs()).toMatchObject([{ kind: "held", state: "running" }]);
		await expect(launch("t3")).rejects.toMatchObject(busy);

		held.release();
		await test.background.settled();
		expect(test.background.runs()).toEqual([
			expect.objectContaining({ task: "held", plannedDate: null, result: "ok" }),
		]);
		expect((await paco.tasks.list()).find(({ id }) => id === "held")).toMatchObject({
			lastRun: { manual: true, result: "ok", error: null },
			stuck: false,
		});
	});

	it("shows in the list the result of the last run and a stuck job", async () => {
		const held = heldTask();
		await using test = createTestPlatform({ modules: [probe], tasks: [held.task] });
		test.prepare.account({ id: "ana", role: "member" });
		await test.prepare.password("ana", PASSWORD);
		test.background.start();
		const ana = await signedIn(test, "ana");
		const listed = async () => (await ana.tasks.list()).find(({ id }) => id === "held");

		// 03:00 in Madrid on the first day: the planned run starts, then fails for good.
		test.clock.set(at("2026-01-01T02:00:00Z"));
		await test.background.flush();
		expect(await listed()).toMatchObject({
			lastRun: { manual: false, result: null },
			stuck: false,
		});
		test.clock.advance(60 * 1000);
		test.clock.advance(10 * 1000);
		expect(await listed()).toMatchObject({ lastRun: { result: null }, stuck: true });

		held.fail(new Error("the disk is full"));
		await test.background.flush();
		expect(await listed()).toMatchObject({ stuck: false });
	});
});

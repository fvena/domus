import { describe, expect, it } from "vitest";

import { createTestPlatform, TEST_ORIGIN, type TestPlatform } from "./platform";

const SECOND = 1000;
const MINUTE = 60 * SECOND;

/** What `/health` answers over the door: its status code and its body. */
async function health(test: TestPlatform) {
	const response = await test.door.fetch(new Request(`${TEST_ORIGIN}/health`));
	return { status: response.status, body: (await response.json()) as unknown };
}

describe("the watcher of the background in /health", () => {
	it("says ok while the scheduler runs", async () => {
		await using test = createTestPlatform({ modules: [] });
		test.background.start();
		test.clock.advance(60 * MINUTE);

		expect(await health(test)).toEqual({
			status: 200,
			body: { status: "ok", background: { status: "ok" } },
		});
	});

	it("says degraded while the scheduler gives no sign of life past the threshold, and ok when it returns", async () => {
		await using test = createTestPlatform({ modules: [] });
		test.background.start();

		test.clock.advance(5 * MINUTE, { wake: false });
		expect((await health(test)).body).toEqual({ status: "ok", background: { status: "ok" } });

		test.clock.advance(1, { wake: false });
		expect(await health(test)).toEqual({
			status: 200,
			body: { status: "ok", background: { status: "degraded", reason: "scheduler-silent" } },
		});

		test.clock.advance(0);
		expect((await health(test)).body).toEqual({ status: "ok", background: { status: "ok" } });
	});

	it("says degraded while a lane is stuck, and ok when its job ends", async () => {
		let end = () => {};
		await using test = createTestPlatform({
			modules: [],
			jobs: {
				stubborn: {
					lane: "short",
					timeout: 30 * SECOND,
					run: () =>
						new Promise<void>((resolve) => {
							end = resolve;
						}),
				},
			},
		});
		test.background.start();
		test.background.enqueue("stubborn");
		await test.background.flush();

		test.clock.advance(30 * SECOND);
		test.clock.advance(10 * SECOND - 1);
		expect((await health(test)).body).toEqual({ status: "ok", background: { status: "ok" } });

		test.clock.advance(1);
		expect(await health(test)).toEqual({
			status: 200,
			body: { status: "ok", background: { status: "degraded", reason: "lane-stuck" } },
		});

		end();
		await test.background.flush();
		expect((await health(test)).body).toEqual({ status: "ok", background: { status: "ok" } });
	});

	it("tells nothing but the states and the reason, never an account or a job", async () => {
		let end = () => {};
		await using test = createTestPlatform({
			modules: [],
			jobs: {
				stubborn: {
					lane: "maintenance",
					timeout: SECOND,
					run: () =>
						new Promise<void>((resolve) => {
							end = resolve;
						}),
				},
			},
		});
		test.prepare.account({ id: "ana", role: "admin" });
		test.background.start();
		test.background.enqueue("stubborn");
		await test.background.flush();
		test.clock.advance(SECOND);
		test.clock.advance(10 * SECOND);
		test.clock.advance(6 * MINUTE, { wake: false });

		const { body } = await health(test);
		expect(body).toEqual({
			status: "ok",
			background: { status: "degraded", reason: "scheduler-silent" },
		});
		expect(JSON.stringify(body)).not.toMatch(/ana|stubborn|maintenance|@/);

		end();
		test.clock.advance(0);
		await test.background.flush();
	});
});

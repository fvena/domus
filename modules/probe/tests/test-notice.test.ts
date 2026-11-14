// The test notice (ADR 0029, «El aviso de prueba»; spec of phase 1d4, «El aviso de prueba»): a person asks from the
// app for a notice to themselves, so the phone can be checked before any module sends one. An irreversible write of
// the platform, with its key and its entry, that needs no level of any area and no proof; its notice is about no
// record, and reaches only the enabled subscriptions of who asked.
import { clientFor } from "@domus/api-client";
import {
	createTestPlatform,
	fakePushService,
	platformContract,
	pushClient,
	type PushClient,
	TEST_ORIGIN,
	type TestBrowser,
	type TestPlatform,
} from "@domus/test-utils";
import { describe, expect, it } from "vitest";

import probe from "../server";

type Probe = TestPlatform<readonly [typeof probe]>;

const PASSWORD = "correct horse battery staple";

/** A platform with probe, a fake push service and its background started; Paco and Rocío, members, with a password. */
async function household() {
	const push = fakePushService();
	const test = createTestPlatform({ modules: [probe], push });
	for (const id of ["paco", "rocio"]) {
		test.prepare.account({ id, role: "member" });
		await test.prepare.password(id, PASSWORD);
	}
	test.background.start();
	return { test, push };
}

async function signedIn(test: Probe, email: string): Promise<TestBrowser> {
	const browser = test.browser();
	expect((await browser.signIn(email, PASSWORD)).status).toBe(200);
	return browser;
}

function clientOf(browser: TestBrowser) {
	return clientFor(platformContract, { baseUrl: TEST_ORIGIN, fetch: browser.fetch });
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

/** Each job of a kind as data: its state and outcome. */
function jobsOf(test: Probe, kind: string) {
	return test.background
		.jobs()
		.filter((job) => job.kind === kind)
		.map(({ id, state, outcome }) => ({ id, state, outcome }));
}

describe("the test notice", () => {
	it("reaches every enabled subscription of who asks and no other, with only its kind and its notice", async () => {
		const { test, push } = await household();
		await using _ = test;
		const phone = await signedIn(test, "paco@domus.test");
		const laptop = await signedIn(test, "paco@domus.test");
		const pacoPhone = await subscribed(phone, "paco-phone");
		const pacoLaptop = await subscribed(laptop, "paco-laptop");
		await subscribed(await signedIn(test, "rocio@domus.test"), "rocio-phone");

		await clientOf(phone).notifications.test(undefined, { context: { idempotencyKey: "t1" } });
		await test.background.runDue();

		expect(push.requests.map(({ url }) => url).sort()).toEqual(
			[pacoLaptop.endpoint, pacoPhone.endpoint].sort(),
		);
		const [notice] = jobsOf(test, "notice");
		expect(notice).toEqual({ id: expect.any(Number), state: "done", outcome: "distributed" });
		for (const client of [pacoPhone, pacoLaptop]) {
			const request = push.requests.find(({ url }) => url === client.endpoint);
			if (!request) throw new Error(`nothing reached ${client.endpoint}`);
			expect(client.read(request)).toEqual({ kind: "test", notice: notice?.id });
		}
		expect(jobsOf(test, "delivery")).toEqual([
			expect.objectContaining({ state: "done", outcome: "sent" }),
			expect.objectContaining({ state: "done", outcome: "sent" }),
		]);
	});

	it("answers well without any subscription, and its notice ends distributed without deliveries", async () => {
		const { test, push } = await household();
		await using _ = test;
		const phone = await signedIn(test, "paco@domus.test");

		expect(
			await clientOf(phone).notifications.test(undefined, {
				context: { idempotencyKey: "t1" },
			}),
		).toEqual({ result: { to: "paco" }, entry: 1 });
		await test.background.runDue();

		expect(
			test.background.jobs().map(({ kind, state, outcome }) => ({ kind, state, outcome })),
		).toEqual([{ kind: "notice", state: "done", outcome: "distributed" }]);
		expect(push.requests).toEqual([]);
	});

	it("leaves its entry in the log, and again under its key answers the acknowledgement without another notice", async () => {
		const { test, push } = await household();
		await using _ = test;
		const phone = await signedIn(test, "paco@domus.test");
		await subscribed(phone, "paco-phone");
		const paco = clientOf(phone);

		await paco.notifications.test(undefined, { context: { idempotencyKey: "t1" } });
		expect(
			await paco.notifications.test(undefined, { context: { idempotencyKey: "t1" } }),
		).toEqual({
			entry: 1,
			repeated: true,
		});
		await test.background.runDue();

		expect(await paco.log.read()).toEqual([
			expect.objectContaining({
				entry: 1,
				action: "platform.testNotice",
				actor: { account: "paco" },
				undoneBy: null,
				touched: [],
			}),
		]);
		expect(jobsOf(test, "notice")).toHaveLength(1);
		expect(push.requests).toHaveLength(1);
	});

	it("cannot be undone", async () => {
		const { test } = await household();
		await using _ = test;
		const paco = clientOf(await signedIn(test, "paco@domus.test"));
		await paco.notifications.test(undefined, { context: { idempotencyKey: "t1" } });

		await expect(
			paco.log.undo({ entry: 1 }, { context: { idempotencyKey: "u1" } }),
		).rejects.toMatchObject({
			code: "UNPROCESSABLE_CONTENT",
			data: { reason: "irreversible" },
		});
	});

	it("needs no level of any area and no proof: a member without access to the platform's area asks for it", async () => {
		const { test, push } = await household();
		await using _ = test;
		test.prepare.grant("rocio", "platform", "none");
		const phone = await signedIn(test, "rocio@domus.test");
		const rocioPhone = await subscribed(phone, "rocio-phone");

		await clientOf(phone).notifications.test(undefined, { context: { idempotencyKey: "t1" } });
		await test.background.runDue();

		expect(push.requests.map(({ url }) => url)).toEqual([rocioPhone.endpoint]);
		await expect(
			test.requestProof(test.contextOf(phone), PASSWORD, { action: "platform.testNotice" }),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});

	it("answers FORBIDDEN to the device account, leaving no entry and no notice", async () => {
		const { test } = await household();
		await using _ = test;
		await test.prepare.password(test.deviceAccount, PASSWORD);
		const kitchen = await signedIn(test, "device@domus.invalid");

		await expect(
			clientOf(kitchen).notifications.test(undefined, { context: { idempotencyKey: "t1" } }),
		).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
		expect(test.log()).toEqual([]);
		expect(test.background.jobs()).toEqual([]);
	});

	it("answers FORBIDDEN via Kira, even from a person's session, leaving no entry and no notice", async () => {
		const { test } = await household();
		await using _ = test;
		const phone = await signedIn(test, "paco@domus.test");
		const viaKira = test.context("paco", { ...test.contextOf(phone), via: "kira" });

		expect(() => test.testNotice(viaKira, { idempotencyKey: "t1" })).toThrow(
			expect.objectContaining({ code: "FORBIDDEN" }),
		);
		expect(test.log()).toEqual([]);
		expect(test.background.jobs()).toEqual([]);
	});
});

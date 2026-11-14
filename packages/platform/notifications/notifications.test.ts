// The list of admitted push services is an option of the platform (spec of phase 1d4, «Servicios de push
// admitidos»): production's unless the composition of a test gives its own, which then admits only its hosts.
import { afterAll, describe, expect, it } from "vitest";

import { createHttpHandler } from "../http";
import { openPlatform } from "../platform";
import { prepareAccount, preparePassword } from "../testing";

const ORIGIN = "http://domus";
const PASSWORD = "a long password";

describe("the push services a platform admits", () => {
	const platform = openPlatform(
		{ databaseFile: ":memory:", modules: [] },
		{ clock: Date.now, pushServices: ["push.domus.test"] },
	);
	afterAll(() => platform.close());
	const door = createHttpHandler({
		platform,
		modules: [],
		auth: { secret: "a-secret-only-for-the-tests-of-the-door", origins: [ORIGIN] },
	});

	/** Ana signed in: the cookies of her browser, as one Cookie header. */
	async function signedIn(): Promise<string> {
		prepareAccount(platform, {
			id: "ana",
			name: "Ana",
			email: "ana@domus.test",
			role: "member",
		});
		await preparePassword(platform, "ana", PASSWORD);
		const response = await door.fetch(
			new Request(`${ORIGIN}/api/auth/sign-in/email`, {
				method: "POST",
				headers: { origin: ORIGIN, "content-type": "application/json" },
				body: JSON.stringify({ email: "ana@domus.test", password: PASSWORD }),
			}),
		);
		expect(response.status).toBe(200);
		return response.headers
			.getSetCookie()
			.map((line) => line.split(";")[0])
			.join("; ");
	}

	it("are those it was given, and no other", async () => {
		const cookie = await signedIn();
		const subscribe = (endpoint: string) =>
			door.fetch(
				new Request(`${ORIGIN}/api/notifications/subscription`, {
					method: "PUT",
					headers: { origin: ORIGIN, cookie, "content-type": "application/json" },
					body: JSON.stringify({ endpoint, keys: { p256dh: "k", auth: "a" } }),
				}),
			);

		expect((await subscribe("https://push.domus.test/s/1")).status).toBe(200);
		const refused = await subscribe("https://fcm.googleapis.com/fcm/send/1");
		expect(refused.status).toBe(400);
		expect(await refused.json()).toMatchObject({
			code: "BAD_REQUEST",
			data: { reason: "push-endpoint-not-allowed" },
		});
	});
});

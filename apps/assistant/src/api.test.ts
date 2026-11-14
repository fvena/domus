import { randomBytes } from "node:crypto";

import { createTestPlatform, PROTOCOL, TEST_ORIGIN } from "@domus/test-utils";
import { describe, expect, it } from "vitest";

import { checkApi } from "./api";

/** A key of the agreed form that nobody created, built at run time: a literal one would stop the commit. */
const unknownKey = () =>
	`domus_${randomBytes(8).toString("base64url")}.${randomBytes(32).toString("base64url")}`;

/** What one check of `assistant` finds with `key` against the door in process. */
async function checkWith(
	door: { readonly fetch: (request: Request) => Promise<Response> },
	key: string | undefined,
) {
	return checkApi({ baseUrl: TEST_ORIGIN, fetch: door.fetch, key })(new AbortController().signal);
}

/** A door whose `status` answers in another protocol, as an api of another version would. */
function speakingAnotherProtocol(door: {
	readonly fetch: (request: Request) => Promise<Response>;
}) {
	return {
		fetch: async (request: Request) => {
			const response = await door.fetch(request);
			const body = (await response.json()) as { json: { protocol: number } };
			body.json.protocol = PROTOCOL + 1;
			return Response.json(body, { status: response.status, headers: response.headers });
		},
	};
}

describe("checkApi", () => {
	it("is ready with the key of kira", async () => {
		await using api = createTestPlatform({ modules: [] });
		expect(await checkWith(api.door, api.prepare.key("kira"))).toBe("ready");
	});

	it("is rejected without a key, though status answers", async () => {
		await using api = createTestPlatform({ modules: [] });
		expect(await checkWith(api.door, undefined)).toBe("rejected");
	});

	it("is rejected with a key nobody created, a malformed one or a revoked one", async () => {
		await using api = createTestPlatform({ modules: [] });
		const revoked = api.prepare.key("kira");
		const [listed] = api.keys();
		if (listed === undefined) throw new Error("the key was not created");
		api.revokeKey(listed.id);
		for (const key of [unknownKey(), "not-a-key", revoked]) {
			expect(await checkWith(api.door, key)).toBe("rejected");
		}
	});

	it("is rejected with the key of another app, though status accepts it", async () => {
		await using api = createTestPlatform({ modules: [], apps: ["tester"] });
		expect(await checkWith(api.door, api.prepare.key("tester"))).toBe("rejected");
	});

	it("is incompatible with another protocol, though the key is good", async () => {
		await using api = createTestPlatform({ modules: [] });
		const key = api.prepare.key("kira");
		expect(await checkWith(speakingAnotherProtocol(api.door), key)).toBe("incompatible");
	});

	it("fails while the api cannot be reached", async () => {
		const check = checkApi({
			baseUrl: TEST_ORIGIN,
			fetch: () => Promise.reject(new Error("down")),
			key: undefined,
		});
		await expect(check(new AbortController().signal)).rejects.toThrow();
	});
});

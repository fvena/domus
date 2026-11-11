import { createTestHttpHandler } from "@domus/test-utils";
import { describe, expect, it } from "vitest";

import { checkApi } from "./api";

describe("checkApi", () => {
	it("finds the api ready in process", async () => {
		const handler = createTestHttpHandler();
		const check = checkApi({ baseUrl: "http://api", fetch: handler.fetch });
		expect(await check(new AbortController().signal)).toBe("ready");
	});

	it("fails while the api cannot be reached", async () => {
		const check = checkApi({
			baseUrl: "http://api",
			fetch: () => Promise.reject(new Error("down")),
		});
		await expect(check(new AbortController().signal)).rejects.toThrow();
	});
});

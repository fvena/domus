import { describe, expect, it } from "vitest";

import { vapidSubject } from "./keys";

describe("the subject of VAPID", () => {
	it("is the first https origin the app is served from, never a mail address", () => {
		expect(
			vapidSubject([
				"http://kira.local:3000",
				"https://domus.tail1234.ts.net",
				"https://other.example",
			]),
		).toBe("https://domus.tail1234.ts.net");
	});

	it("is missing without an https origin, so the platform does not send", () => {
		expect(vapidSubject(["http://kira.local:3000", "http://192.168.1.20"])).toBeUndefined();
		expect(vapidSubject([])).toBeUndefined();
	});
});

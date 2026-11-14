import { describe, expect, it } from "vitest";

import { endpointAllowed, PUSH_SERVICES } from "./endpoint";

describe("which push endpoints are accepted", () => {
	it("admits each known service, over https on port 443 implicit or explicit", () => {
		expect(
			[
				"https://web.push.apple.com/QGuQyavXutnMH",
				"https://fcm.googleapis.com/fcm/send/dpH5lCsTSSM:APA91bH",
				"https://updates.push.services.mozilla.com/wpush/v2/gAAAAABe",
				"https://fcm.googleapis.com:443/fcm/send/abc",
			].map((endpoint) => endpointAllowed(endpoint, PUSH_SERVICES)),
		).toEqual([true, true, true, true]);
	});

	it("reads the host without regard to case, as a URL does", () => {
		expect(endpointAllowed("https://FCM.GoogleAPIs.com/fcm/send/abc", PUSH_SERVICES)).toBe(
			true,
		);
	});

	it("refuses hosts that only look like a known one", () => {
		expect(
			[
				"https://evil.fcm.googleapis.com/send",
				"https://fcm.googleapis.com.evil.test/send",
				"https://xfcm.googleapis.com/send",
				"https://fcm.googleapis.co/send",
				"https://fcm.googleapis.com./send",
				"https://notify.windows.com/w/?token=abc",
			].map((endpoint) => endpointAllowed(endpoint, PUSH_SERVICES)),
		).toEqual([false, false, false, false, false, false]);
	});

	it("refuses an IP, another port, a user or password, and any scheme but https", () => {
		expect(
			[
				"https://142.250.184.10/fcm/send/abc",
				"https://[2a00:1450:4003:80e::200a]/fcm/send/abc",
				"https://fcm.googleapis.com:8443/fcm/send/abc",
				"https://user@fcm.googleapis.com/fcm/send/abc",
				"https://user:secret@fcm.googleapis.com/fcm/send/abc",
				"https://:secret@fcm.googleapis.com/fcm/send/abc",
				"http://fcm.googleapis.com/fcm/send/abc",
				"wss://fcm.googleapis.com/fcm/send/abc",
				"fcm.googleapis.com/fcm/send/abc",
				"",
			].map((endpoint) => endpointAllowed(endpoint, PUSH_SERVICES)),
		).toEqual([false, false, false, false, false, false, false, false, false, false]);
	});

	it("takes the list it is given, so another list admits only its own hosts", () => {
		const fake = ["push.domus.test"];
		expect(endpointAllowed("https://push.domus.test/s/1", fake)).toBe(true);
		expect(endpointAllowed("https://fcm.googleapis.com/fcm/send/abc", fake)).toBe(false);
	});
});

import { describe, expect, it } from "vitest";

import {
	classifyAnswer,
	PUSH_REDIRECT,
	PUSH_REJECTED,
	PUSH_UNAUTHORIZED,
	retryAfterInstant,
} from "./answers";

const NOW = Date.parse("2026-11-14T10:00:00Z");

/** The class of an answer with `status` and no `Retry-After`. */
const ofStatus = (status: number) => classifyAnswer({ status, retryAfter: null }, NOW);

describe("what an answer of the push service means", () => {
	it("is sent for any 2xx", () => {
		expect([200, 201, 202, 204, 299].map(ofStatus)).toEqual(
			Array.from({ length: 5 }, () => ({ kind: "sent" })),
		);
	});

	it("is a subscription gone for 404 and 410", () => {
		expect([404, 410].map(ofStatus)).toEqual([{ kind: "gone" }, { kind: "gone" }]);
	});

	it("is refused for good, rejected, for 400 and 413 and any other 4xx but 429", () => {
		expect([400, 413, 405, 422].map(ofStatus)).toEqual(
			Array.from({ length: 4 }, () => ({ kind: "refused", code: PUSH_REJECTED })),
		);
	});

	it("is refused for good, unauthorized, for 401 and 403", () => {
		expect([401, 403].map(ofStatus)).toEqual([
			{ kind: "refused", code: PUSH_UNAUTHORIZED },
			{ kind: "refused", code: PUSH_UNAUTHORIZED },
		]);
	});

	it("is refused for good, a redirect, for any 3xx", () => {
		expect([300, 301, 302, 307, 308].map(ofStatus)).toEqual(
			Array.from({ length: 5 }, () => ({ kind: "refused", code: PUSH_REDIRECT })),
		);
	});

	it("is passing for 429, any 5xx, a network error and a timeout", () => {
		expect([
			...[429, 500, 502, 503, 504].map(ofStatus),
			classifyAnswer("network-error", NOW),
			classifyAnswer("timed-out", NOW),
		]).toEqual(Array.from({ length: 7 }, () => ({ kind: "passing" })));
	});

	it("is passing not before the instant `Retry-After` asks for, on 429 and 503", () => {
		expect(
			[429, 503].map((status) => classifyAnswer({ status, retryAfter: "120" }, NOW)),
		).toEqual([
			{ kind: "passing", notBefore: NOW + 120 * 1000 },
			{ kind: "passing", notBefore: NOW + 120 * 1000 },
		]);
	});

	it("reads no `Retry-After` on any other status", () => {
		expect(
			[500, 201, 404].map((status) => classifyAnswer({ status, retryAfter: "120" }, NOW)),
		).toEqual([{ kind: "passing" }, { kind: "sent" }, { kind: "gone" }]);
	});

	it("is passing with the growing wait alone when `Retry-After` is invalid", () => {
		expect(classifyAnswer({ status: 503, retryAfter: "soon" }, NOW)).toEqual({
			kind: "passing",
		});
	});
});

describe("the instant `Retry-After` asks for", () => {
	it("is now plus its seconds", () => {
		expect(["0", "1", "120", "0086400"].map((value) => retryAfterInstant(value, NOW))).toEqual([
			NOW,
			NOW + 1000,
			NOW + 120 * 1000,
			NOW + 86_400 * 1000,
		]);
	});

	it("is its HTTP date", () => {
		expect(retryAfterInstant("Sat, 14 Nov 2026 10:05:30 GMT", NOW)).toBe(
			Date.parse("2026-11-14T10:05:30Z"),
		);
	});

	it("is the instant asked for when it goes past the deadline of a day: the delivery decides on it", () => {
		expect([
			retryAfterInstant("172800", NOW),
			retryAfterInstant("Mon, 16 Nov 2026 10:00:00 GMT", NOW),
		]).toEqual([NOW + 2 * 86_400 * 1000, Date.parse("2026-11-16T10:00:00Z")]);
	});

	it("is a date already past as such, so the growing wait comes after it", () => {
		expect(retryAfterInstant("Sun, 06 Nov 1994 08:49:37 GMT", NOW)).toBe(
			Date.parse("1994-11-06T08:49:37Z"),
		);
	});

	it("is none for an invalid value", () => {
		expect(
			[
				"",
				"soon",
				"-5",
				"1.5",
				"1e3",
				" 120",
				"120s",
				"2026-11-14T10:05:30Z",
				"Sat, 14 Nov 2026 10:05:30",
				"Sat, 31 Feb 2026 10:05:30 GMT",
				"Sat, 14 Nov 2026 25:05:30 GMT",
				"Sat, 14 Foo 2026 10:05:30 GMT",
				"9".repeat(400),
			].map((value) => retryAfterInstant(value, NOW)),
		).toEqual(Array.from({ length: 13 }, () => undefined));
	});
});

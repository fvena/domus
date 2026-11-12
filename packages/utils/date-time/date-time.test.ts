import { describe, expect, it } from "vitest";

import { localDate, nextDailyOccurrence } from ".";

const MADRID = "Europe/Madrid";
const at = (iso: string) => Date.parse(iso);

describe("nextDailyOccurrence", () => {
	it("is the next local HH:MM of the zone after the instant", () => {
		// 01:00 in Madrid (CET, +01:00): 04:30 is later that same day.
		expect(nextDailyOccurrence(at("2026-01-01T00:00:00Z"), "04:30", MADRID)).toBe(
			at("2026-01-01T03:30:00Z"),
		);
		// 05:00 in Madrid: today's 04:30 has passed, so tomorrow's.
		expect(nextDailyOccurrence(at("2026-01-01T04:00:00Z"), "04:30", MADRID)).toBe(
			at("2026-01-02T03:30:00Z"),
		);
		// In summer time (CEST, +02:00).
		expect(nextDailyOccurrence(at("2026-07-01T00:00:00Z"), "04:30", MADRID)).toBe(
			at("2026-07-01T02:30:00Z"),
		);
	});

	it("is strictly after the instant: at an occurrence, the next day's", () => {
		expect(nextDailyOccurrence(at("2026-01-01T03:30:00Z"), "04:30", MADRID)).toBe(
			at("2026-01-02T03:30:00Z"),
		);
	});

	it("moves a time that does not exist, the last Sunday of March, to the first valid one: 03:00", () => {
		// 2026-03-29: clocks go from 02:00 CET to 03:00 CEST.
		expect(nextDailyOccurrence(at("2026-03-28T22:00:00Z"), "02:30", MADRID)).toBe(
			at("2026-03-29T01:00:00Z"),
		);
		// The day after, 02:30 exists again, in summer time.
		expect(nextDailyOccurrence(at("2026-03-29T01:00:00Z"), "02:30", MADRID)).toBe(
			at("2026-03-30T00:30:00Z"),
		);
	});

	it("takes the first appearance of a time that repeats, the last Sunday of October, and only once", () => {
		// 2026-10-25: clocks go from 03:00 CEST back to 02:00 CET, so 02:30 happens at 00:30Z and at 01:30Z.
		expect(nextDailyOccurrence(at("2026-10-24T22:00:00Z"), "02:30", MADRID)).toBe(
			at("2026-10-25T00:30:00Z"),
		);
		// After the first appearance, the second one is not another occurrence: the next is the day after.
		expect(nextDailyOccurrence(at("2026-10-25T00:30:00Z"), "02:30", MADRID)).toBe(
			at("2026-10-26T01:30:00Z"),
		);
	});

	it("crosses the end of the year", () => {
		expect(nextDailyOccurrence(at("2026-12-31T04:00:00Z"), "04:30", MADRID)).toBe(
			at("2027-01-01T03:30:00Z"),
		);
	});

	it("uses the zone it is given, not the process's", () => {
		// Auckland is at +13:00 in January: 13:00 local on 1 January, so 04:30 on the 2nd.
		expect(nextDailyOccurrence(at("2026-01-01T00:00:00Z"), "04:30", "Pacific/Auckland")).toBe(
			at("2026-01-01T15:30:00Z"),
		);
		expect(nextDailyOccurrence(at("2026-01-01T00:00:00Z"), "04:30", "UTC")).toBe(
			at("2026-01-01T04:30:00Z"),
		);
	});

	it.each(["4:30", "24:00", "12:60", "noon", ""])("refuses the time %j", (time) => {
		expect(() => nextDailyOccurrence(0, time, MADRID)).toThrow(/HH:MM/);
	});
});

describe("localDate", () => {
	it("is the calendar date of the instant in the zone", () => {
		const instant = at("2026-10-24T22:30:00Z");
		expect(localDate(instant, MADRID)).toBe("2026-10-25");
		expect(localDate(instant, "UTC")).toBe("2026-10-24");
		expect(localDate(at("2026-12-31T23:30:00Z"), MADRID)).toBe("2027-01-01");
	});
});

// Local times of a time zone, given as a parameter and never read from the process (`TZ`), on date-fns and its
// zone support. Instants are milliseconds since the epoch; local dates are `YYYY-MM-DD`; times of day `HH:MM`.
// Around a change of the clocks, a local time that does not exist moves to the first valid one, and one that
// repeats counts once, at its first appearance.
import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** The calendar date of `instant` in `zone`, as `YYYY-MM-DD`. */
export function localDate(instant: number, zone: string): string {
	return format(new TZDate(instant, zone), "yyyy-MM-dd");
}

/**
 * The first instant strictly after `after` when the clocks of `zone` show `time` (`HH:MM`), once per local day.
 * A time that does not exist that day (the clocks jump over it) is the first valid instant after it; a time that
 * happens twice (the clocks go back over it) is its first appearance.
 */
export function nextDailyOccurrence(after: number, time: string, zone: string): number {
	const match = TIME.exec(time);
	if (!match)
		throw new Error(`a time of day is written HH:MM, from 00:00 to 23:59, got "${time}"`);
	const hour = Number(match[1]);
	const minute = Number(match[2]);

	const today = new TZDate(after, zone);
	// The occurrence of the local day of `after` may have passed; the next day's never has.
	for (let day = 0; day <= 1; day++) {
		const wall = Date.UTC(
			today.getFullYear(),
			today.getMonth(),
			today.getDate() + day,
			hour,
			minute,
		);
		const instant = firstInstantAt(wall, zone);
		if (instant > after) return instant;
	}
	throw new Error("unreachable: the next local day always has an occurrence");
}

/**
 * The first instant whose local wall clock in `zone` reads `wall` (the local time written as if it were UTC), or,
 * when the clocks jump over it, the first instant after the jump.
 */
function firstInstantAt(wall: number, zone: string): number {
	// A local time this far from a change of the clocks has a single offset; any change happens in between.
	for (let shifted = wall; shifted < wall + DAY; shifted += MINUTE) {
		const candidates = [offsetAt(shifted - DAY, zone), offsetAt(shifted + DAY, zone)]
			.map((offset) => shifted - offset)
			.filter((instant) => wallAt(instant, zone) === shifted);
		if (candidates.length > 0) return Math.min(...candidates);
	}
	throw new Error(`no instant shows ${new Date(wall).toISOString()} in ${zone}`);
}

/** How far ahead of UTC the clocks of `zone` are at `instant`, in milliseconds. */
function offsetAt(instant: number, zone: string): number {
	return wallAt(instant, zone) - Math.floor(instant / MINUTE) * MINUTE;
}

/** The local wall clock of `zone` at `instant`, to the minute, written as if it were UTC. */
function wallAt(instant: number, zone: string): number {
	const local = new TZDate(instant, zone);
	return Date.UTC(
		local.getFullYear(),
		local.getMonth(),
		local.getDate(),
		local.getHours(),
		local.getMinutes(),
	);
}

// What the push service's answer to a delivery means (ADR 0029, spec of phase 1d4, «La entrega y el envío»): sent,
// a subscription the service forgot, a refusal for good, or a passing failure the engine retries, not before the
// instant a `Retry-After` asks for. Pure: the delivery acts on it.

/** The code of a delivery the push service refused as malformed or too large: sending it again cannot help. */
export const PUSH_REJECTED = "PUSH_REJECTED";
/** The code of a delivery the push service refused the VAPID signature of. The subscription stays. */
export const PUSH_UNAUTHORIZED = "PUSH_UNAUTHORIZED";
/** The code of a delivery the push service answered with a redirect, which Domus never follows. */
export const PUSH_REDIRECT = "PUSH_REDIRECT";

/** How a request to the push service ended: its status and `Retry-After`, or without an answer. */
export type PushResult =
	| { readonly status: number; readonly retryAfter: string | null }
	| "network-error"
	| "timed-out";

/** What a request's end means for its delivery. */
export type PushAnswer =
	| { readonly kind: "sent" }
	/** The service no longer knows the subscription: Domus forgets it too. */
	| { readonly kind: "gone" }
	| {
			readonly kind: "refused";
			readonly code: typeof PUSH_REJECTED | typeof PUSH_UNAUTHORIZED | typeof PUSH_REDIRECT;
	  }
	/** Retried with the engine's growing wait and, when the service asked for one, not before `notBefore`. */
	| { readonly kind: "passing"; readonly notBefore?: number };

/**
 * What `result` means at `now`. Any 2xx is sent; 404 and 410, gone; 401 and 403, unauthorized; any other 4xx but
 * 429, rejected; 3xx, a redirect; 429, 5xx and no answer, passing, with the instant of a valid `Retry-After` on
 * 429 and 503.
 */
export function classifyAnswer(result: PushResult, now: number): PushAnswer {
	if (typeof result === "string") return { kind: "passing" };
	const { status, retryAfter } = result;
	if (status >= 200 && status < 300) return { kind: "sent" };
	if (status >= 300 && status < 400) return { kind: "refused", code: PUSH_REDIRECT };
	if (status === 404 || status === 410) return { kind: "gone" };
	if (status === 401 || status === 403) return { kind: "refused", code: PUSH_UNAUTHORIZED };
	if (status === 429 || status === 503) {
		const notBefore = retryAfter === null ? undefined : retryAfterInstant(retryAfter, now);
		return notBefore === undefined ? { kind: "passing" } : { kind: "passing", notBefore };
	}
	if (status >= 400 && status < 500) return { kind: "refused", code: PUSH_REJECTED };
	return { kind: "passing" };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** An HTTP date in its one current form, IMF-fixdate (RFC 9110): `Sun, 06 Nov 1994 08:49:37 GMT`. */
const IMF_FIXDATE =
	/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), (\d{2}) ([A-Z][a-z]{2}) (\d{4}) (\d{2}):(\d{2}):(\d{2}) GMT$/;

/**
 * The instant a `Retry-After` value asks not to retry before, from `now`: its delay in seconds, or its HTTP date
 * (IMF-fixdate; the obsolete forms are not read). Undefined for anything else, a date that does not exist
 * included. An instant past any deadline is given as it is: the delivery decides on it.
 */
export function retryAfterInstant(value: string, now: number): number | undefined {
	if (/^\d+$/.test(value)) {
		const instant = now + Number(value) * 1000;
		return Number.isSafeInteger(instant) ? instant : undefined;
	}
	const match = IMF_FIXDATE.exec(value);
	if (!match) return undefined;
	const [day, month, year, hours, minutes, seconds] = match
		.slice(1)
		.map((part, index) => (index === 1 ? MONTHS.indexOf(part) : Number(part))) as [
		number,
		number,
		number,
		number,
		number,
		number,
	];
	if (month < 0) return undefined;
	const instant = Date.UTC(year, month, day, hours, minutes, seconds);
	const date = new Date(instant);
	// Date.UTC carries an overflowing field into the next: a date that does not exist reads back different.
	const exists =
		date.getUTCDate() === day &&
		date.getUTCMonth() === month &&
		date.getUTCHours() === hours &&
		date.getUTCMinutes() === minutes &&
		date.getUTCSeconds() === seconds;
	return exists ? instant : undefined;
}

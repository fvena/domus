// Whether a notice may go to its recipient (ADR 0029, «A quién va un aviso»): a person, and a record that still
// exists and that the person sees now, with the permissions in force when it is delivered: for an area table's
// record, `read` in its area is enough. Pure, over the same view as `decide`.
import { describe, expect, it } from "vitest";

import type { AccessView, AreaPolicy, Grant } from ".";
import { noticeDecision, testNoticeDecision } from "./notices";

const AREA: AreaPolicy = {
	defaultVisibility: "private",
	publicEditable: false,
	alwaysPrivate: false,
	confirmOnSharedDevice: false,
};

/** Ana, the admin, Luis, a member with `grant` stored in the area, and the device account. */
function view(grant?: Grant): AccessView {
	return {
		roleOf: (account) =>
			account === "ana"
				? "admin"
				: account === "luis"
					? "member"
					: account === "screen"
						? "device"
						: undefined,
		storedGrant: (account) => (account === "luis" ? grant : undefined),
		delegated: () => undefined,
		area: (id) => (id === "jot" ? AREA : undefined),
	};
}

const anaPrivate = { area: "jot", owner: "ana", visibility: "private" } as const;
const anaPublic = { area: "jot", owner: "ana", visibility: "public" } as const;
const luisPrivate = { area: "jot", owner: "luis", visibility: "private" } as const;

describe("a notice", () => {
	it("goes to a person who sees the record: its owner, or anyone who reads the area when it is public", () => {
		expect(noticeDecision(view(), "luis", luisPrivate)).toBe("deliver");
		expect(noticeDecision(view(), "luis", anaPublic)).toBe("deliver");
		expect(noticeDecision(view(), "ana", anaPrivate)).toBe("deliver");
	});

	it("does not go to the device account, nor to an account that does not exist, whatever the record", () => {
		expect(noticeDecision(view(), "screen", anaPublic)).toBe("not-member");
		expect(noticeDecision(view(), "nobody", anaPublic)).toBe("not-member");
		expect(noticeDecision(view(), "screen", null)).toBe("not-member");
	});

	it("does not go once the record is gone", () => {
		expect(noticeDecision(view(), "luis", null)).toBe("record-gone");
	});

	it("does not go about a private record of another person, not even to the admin", () => {
		expect(noticeDecision(view(), "luis", anaPrivate)).toBe("not-visible");
		expect(noticeDecision(view(), "ana", luisPrivate)).toBe("not-visible");
	});

	it("does not go to a person without read in the record's area, though the record is public", () => {
		expect(noticeDecision(view("none"), "luis", anaPublic)).toBe("not-visible");
		expect(noticeDecision(view("none"), "luis", luisPrivate)).toBe("not-visible");
		expect(noticeDecision(view("read"), "luis", anaPublic)).toBe("deliver");
	});

	it("does not go about a record of an area that is not registered", () => {
		expect(noticeDecision(view(), "luis", { ...luisPrivate, area: "gone" })).toBe(
			"not-visible",
		);
	});
});

describe("a notice about an area table's record", () => {
	const label = { area: "jot" } as const;

	it("goes to any person with read in its area, who owns nothing there", () => {
		expect(noticeDecision(view(), "luis", label)).toBe("deliver");
		expect(noticeDecision(view(), "ana", label)).toBe("deliver");
		expect(noticeDecision(view("read"), "luis", label)).toBe("deliver");
	});

	it("does not go to a person without read in its area, nor to one that is not a person", () => {
		expect(noticeDecision(view("none"), "luis", label)).toBe("not-visible");
		expect(noticeDecision(view(), "luis", { area: "gone" })).toBe("not-visible");
		expect(noticeDecision(view(), "screen", label)).toBe("not-member");
	});
});

describe("the test notice", () => {
	it("goes to a person, about no record, whatever the person reads", () => {
		expect(testNoticeDecision(view("none"), "luis")).toBe("deliver");
		expect(testNoticeDecision(view(), "ana")).toBe("deliver");
	});

	it("does not go to the device account, nor to an account that does not exist", () => {
		expect(testNoticeDecision(view(), "screen")).toBe("not-member");
		expect(testNoticeDecision(view(), "nobody")).toBe("not-member");
	});
});

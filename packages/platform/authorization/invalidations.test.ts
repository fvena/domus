// Who a changed record reaches on the live channel (ADR 0029): the account has `read` in its area now, and saw the
// record before the write or sees it after; a record of an area table reaches whoever has `read` in its area now.
// Pure, over the same view as `decide`.
import { describe, expect, it } from "vitest";

import type { AccessView, AreaPolicy, Grant } from ".";
import { invalidationReaches, type OwnedRecordChange, readLost } from "./invalidations";
import type { Ownership } from "./visibility";

const AREA: AreaPolicy = {
	defaultVisibility: "private",
	publicEditable: false,
	alwaysPrivate: false,
	confirmOnSharedDevice: false,
};

/** Ana and Luis, members, and the device account; `luis` has `grant` stored in the area. */
function view(grant?: Grant): AccessView {
	return {
		roleOf: (account) =>
			account === "ana" || account === "luis"
				? "member"
				: account === "screen"
					? "device"
					: undefined,
		storedGrant: (account) => (account === "luis" ? grant : undefined),
		delegated: () => undefined,
		area: (id) => (id === "jot" ? AREA : undefined),
	};
}

const anaPrivate: Ownership = { owner: "ana", visibility: "private" };
const anaPublic: Ownership = { owner: "ana", visibility: "public" };

function change(
	before: OwnedRecordChange["before"],
	after: OwnedRecordChange["after"],
	area = "jot",
): OwnedRecordChange {
	return { module: "jot", type: "jot", id: 1, area, before, after };
}

describe("an invalidation", () => {
	it("reaches the owner of a private record, and nobody else", () => {
		const created = change(null, anaPrivate);
		expect(invalidationReaches(view(), "ana", created)).toBe(true);
		expect(invalidationReaches(view(), "luis", created)).toBe(false);
		expect(invalidationReaches(view(), "screen", created)).toBe(false);
	});

	it("reaches whoever reads the area for a public record, the device account included", () => {
		const created = change(null, anaPublic);
		expect(invalidationReaches(view(), "luis", created)).toBe(true);
		expect(invalidationReaches(view(), "screen", created)).toBe(true);
	});

	it("reaches whoever saw it before or sees it after", () => {
		expect(invalidationReaches(view(), "luis", change(anaPublic, anaPrivate))).toBe(true);
		expect(invalidationReaches(view(), "luis", change(anaPrivate, anaPublic))).toBe(true);
		expect(invalidationReaches(view(), "luis", change(anaPrivate, anaPrivate))).toBe(false);
	});

	it("reaches who saw a deleted record, and not who never did", () => {
		expect(invalidationReaches(view(), "luis", change(anaPublic, null))).toBe(true);
		expect(invalidationReaches(view(), "luis", change(anaPrivate, null))).toBe(false);
		expect(invalidationReaches(view(), "ana", change(anaPrivate, null))).toBe(true);
	});

	it("reaches nobody for a record created and deleted in the same write", () => {
		expect(invalidationReaches(view(), "ana", change(null, null))).toBe(false);
	});

	it("needs read in the area now, even on a public record or one's own", () => {
		expect(invalidationReaches(view("none"), "luis", change(null, anaPublic))).toBe(false);
		expect(invalidationReaches(view("read"), "luis", change(null, anaPublic))).toBe(true);
		const own = change(null, { owner: "luis", visibility: "private" });
		expect(invalidationReaches(view("none"), "luis", own)).toBe(false);
	});

	it("reaches nobody in an area that is not registered, nor an account that does not exist", () => {
		expect(invalidationReaches(view(), "luis", change(null, anaPublic, "gone"))).toBe(false);
		expect(invalidationReaches(view(), "nadie", change(null, anaPublic))).toBe(false);
	});
});

describe("an invalidation of an area table's record", () => {
	const label = (area = "jot") => ({ module: "jot", type: "label", id: 1, area });

	it("reaches every account with read in its area, the device account included", () => {
		expect(invalidationReaches(view(), "ana", label())).toBe(true);
		expect(invalidationReaches(view(), "luis", label())).toBe(true);
		expect(invalidationReaches(view(), "screen", label())).toBe(true);
	});

	it("reaches nobody without read in its area now, nor in an area that is not registered", () => {
		expect(invalidationReaches(view("none"), "luis", label())).toBe(false);
		expect(invalidationReaches(view("read"), "luis", label())).toBe(true);
		expect(invalidationReaches(view(), "luis", label("gone"))).toBe(false);
		expect(invalidationReaches(view(), "nadie", label())).toBe(false);
	});
});

describe("whether a change of grant takes away read", () => {
	it("is true only from a grant that reads to one that does not", () => {
		const grants: readonly Grant[] = ["none", "read", "write", "manage"];
		const lost = grants.flatMap((before) =>
			grants.filter((after) => readLost(before, after)).map((after) => `${before}→${after}`),
		);
		expect(lost).toEqual(["read→none", "write→none", "manage→none"]);
	});
});

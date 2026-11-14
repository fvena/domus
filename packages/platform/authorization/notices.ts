// Whether a notice may go to its recipient (ADR 0029, «A quién va un aviso»). Pure, like `decide`: the grant comes
// from the same view, with the permissions in force when the notice is shared out or delivered, and the record's
// facts from the platform, gathered then.
import type { Visibility } from "@domus/module-sdk";

import { type AccessView, grantOf, isPerson, reaches } from "./index";
import { isVisibleTo } from "./visibility";

/** A record of an area table as a notice finds it: only its area. */
export interface AreaNoticeRecord {
	readonly area: string;
}

/** A record of an owned table as a notice finds it: its area, its owner and its visibility. */
export interface OwnedNoticeRecord extends AreaNoticeRecord {
	readonly owner: string;
	readonly visibility: Visibility;
}

/** A record as a notice finds it, of an owned table or of an area table. */
export type NoticeRecord = OwnedNoticeRecord | AreaNoticeRecord;

/**
 * What becomes of a notice: it goes, or why it does not. `not-member`: its recipient is not a person (the device
 * account, or no account). `record-gone`: the record no longer exists. `not-visible`: the recipient does not see it.
 */
export type NoticeDecision = "deliver" | "not-member" | "record-gone" | "not-visible";

/**
 * Whether a notice about `record`, `null` once it no longer exists, goes to `to`: a person with `read` in the
 * record's area who, in an owned table, owns it or for whom it is public.
 */
export function noticeDecision(
	view: AccessView,
	to: string,
	record: NoticeRecord | null,
): NoticeDecision {
	if (!isPerson(view, to)) return "not-member";
	if (record === null) return "record-gone";
	if (!reaches(grantOf(view, to, record.area), "read")) return "not-visible";
	if (!("owner" in record)) return "deliver";
	return isVisibleTo(record, to) ? "deliver" : "not-visible";
}

/**
 * Whether the test notice (ADR 0029, «El aviso de prueba») goes to `to`, who asked for it: about no record, so only
 * that `to` is a person.
 */
export function testNoticeDecision(view: AccessView, to: string): "deliver" | "not-member" {
	return isPerson(view, to) ? "deliver" : "not-member";
}

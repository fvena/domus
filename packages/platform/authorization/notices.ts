// Whether a notice may go to its recipient (ADR 0029, «A quién va un aviso»). Pure, like `decide`: the grant comes
// from the same view, with the permissions in force when the notice is shared out or delivered, and the record's
// facts from the platform, gathered then.
import { type AccessView, grantOf, reaches } from "./index";

/** A record of an owned table as a notice finds it: its area, its owner and its visibility. */
export interface NoticeRecord {
	readonly area: string;
	readonly owner: string;
	readonly visibility: string;
}

/**
 * What becomes of a notice: it goes, or why it does not. `not-member`: its recipient is not a person (the device
 * account, or no account). `record-gone`: the record no longer exists. `not-visible`: the recipient does not see it.
 */
export type NoticeDecision = "deliver" | "not-member" | "record-gone" | "not-visible";

/**
 * Whether a notice about `record`, `null` once it no longer exists, goes to `to`: a person with `read` in the
 * record's area, who owns it or for whom it is public.
 */
export function noticeDecision(
	view: AccessView,
	to: string,
	record: NoticeRecord | null,
): NoticeDecision {
	const role = view.roleOf(to);
	if (role !== "admin" && role !== "member") return "not-member";
	if (record === null) return "record-gone";
	if (!reaches(grantOf(view, to, record.area), "read")) return "not-visible";
	return record.owner === to || record.visibility === "public" ? "deliver" : "not-visible";
}

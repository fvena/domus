// Who a changed record reaches on the live channel (ADR 0029). Pure, like `decide`: the grant comes from the same
// view, with the permissions in force when the write is shared out, and the record's state from the write capture.
import { type AccessView, type Grant, grantOf, reaches } from "./index";

/**
 * Whether an account whose grant in an area went from `before` to `after` lost `read` there: its channels close
 * after their `reset`, and reconnect with what it may see now.
 */
export function readLost(before: Grant, after: Grant): boolean {
	return reaches(before, "read") && !reaches(after, "read");
}

/** An owned record's state, as the write capture saw it: its owner and its visibility. */
export interface RecordState {
	readonly owner: string | null;
	readonly visibility: string | null;
}

/**
 * A record a committed write changed: who it is, its area, and its first state before the write and its last
 * after it, `null` where it did not exist. The states in between never count.
 */
export interface RecordChange {
	readonly module: string;
	readonly type: string;
	readonly id: number;
	readonly area: string;
	readonly before: RecordState | null;
	readonly after: RecordState | null;
}

/**
 * Whether the change reaches a channel of `account`: it has `read` in the record's area now, and the record was
 * its own or public before the write, or is after it.
 */
export function invalidationReaches(
	view: AccessView,
	account: string,
	change: RecordChange,
): boolean {
	if (!reaches(grantOf(view, account, change.area), "read")) return false;
	return seenBy(change.before, account) || seenBy(change.after, account);
}

function seenBy(state: RecordState | null, account: string): boolean {
	return state !== null && (state.owner === account || state.visibility === "public");
}

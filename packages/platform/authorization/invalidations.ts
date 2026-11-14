// Who a changed record reaches on the live channel (ADR 0029). Pure, like `decide`: the grant comes from the same
// view, with the permissions in force when the write is shared out, and the record's state from the write capture.
import { type AccessView, type Grant, grantOf, reaches } from "./index";
import { isVisibleTo, type Ownership } from "./visibility";

/**
 * Whether an account whose grant in an area went from `before` to `after` lost `read` there: its channels close
 * after their `reset`, and reconnect with what it may see now.
 */
export function readLost(before: Grant, after: Grant): boolean {
	return reaches(before, "read") && !reaches(after, "read");
}

/**
 * Which record of a module's owned or area tables: its module, its record type and its integer id. What a change
 * names and a notice is about.
 */
export interface RecordKey {
	readonly module: string;
	readonly type: string;
	readonly id: number;
}

/** A record a committed write changed, of an area table: who it is and its area, with no owner nor visibility. */
export interface AreaRecordChange extends RecordKey {
	readonly area: string;
}

/**
 * A record of an owned table a committed write changed: who it is, its area, and its first state before the write
 * and its last after it, as the write capture saw them, `null` where it did not exist. The states in between never
 * count.
 */
export interface OwnedRecordChange extends AreaRecordChange {
	readonly before: Ownership | null;
	readonly after: Ownership | null;
}

/** A record a committed write changed: of an owned table, with its states, or of an area table, without them. */
export type RecordChange = OwnedRecordChange | AreaRecordChange;

/**
 * Whether the change reaches a channel of `account`: it has `read` in the record's area now and, in an owned
 * table, the record was its own or public before the write, or is after it.
 */
export function invalidationReaches(
	view: AccessView,
	account: string,
	change: RecordChange,
): boolean {
	if (!reaches(grantOf(view, account, change.area), "read")) return false;
	if (!("before" in change)) return true;
	return seenBy(change.before, account) || seenBy(change.after, account);
}

function seenBy(state: Ownership | null, account: string): boolean {
	return state !== null && isVisibleTo(state, account);
}

// What a write may do to an owned record (ADR 0023), checked on each row transition the write capture saw. The
// same rules as visibility on reads: the owner, or anyone with `write` on a public record where its area allows
// it. Pure, like `decide`: the grant comes from the same view. `editableTo` puts the same rule in a handler's
// query, for the one case that must know before it writes (ADR 0024).
import type { OwnedTable, Visibility } from "@domus/module-sdk";
import { eq, type SQL } from "drizzle-orm";

import { type AccessView, type AreaPolicy, grantOf, reaches } from "./index";
import { visibleTo } from "./visibility";

/** One row transition of an owned table, as the capture saw it: `old*` is empty on insert, `new*` on delete. */
export interface RowTransition {
	readonly operation: "insert" | "update" | "delete";
	readonly oldId: number | null;
	readonly newId: number | null;
	readonly oldOwner: string | null;
	readonly newOwner: string | null;
	readonly oldVisibility: Visibility | null;
	readonly newVisibility: Visibility | null;
}

/**
 * What a transition is: `allow`ed; `forbidden`, a question of authorization (editing another's public record
 * where its area or the account's grant does not allow it, or changing the visibility of another's record);
 * or `invalid`, a handler that broke the rules every write keeps (another owner, another key, another's private
 * record, which its visibility predicate hides).
 */
export type TransitionCheck = "allow" | "forbidden" | "invalid";

/** The record's area: its id, for the account's grant, and what it declares. */
export interface RecordArea {
	readonly id: string;
	readonly policy: AreaPolicy;
}

/** Checks one transition made on behalf of `account` in a record of `area`. */
export function checkTransition(
	transition: RowTransition,
	account: string,
	area: RecordArea,
	view: AccessView,
): TransitionCheck {
	const { operation, oldId, newId, oldOwner, newOwner, oldVisibility, newVisibility } =
		transition;
	if (operation === "insert") return newOwner === account ? "allow" : "invalid";
	if (operation === "update" && (newOwner !== oldOwner || newId !== oldId)) return "invalid";

	const change = mayChange(oldOwner, oldVisibility, account, area, view);
	if (change !== "allow") return change;
	// Only the owner changes the visibility, even where anyone with `write` edits a public record.
	if (operation === "update" && newVisibility !== oldVisibility && oldOwner !== account)
		return "forbidden";
	return "allow";
}

/** Whether `account` may edit or delete a record as it was before the change. */
function mayChange(
	owner: string | null,
	visibility: Visibility | null,
	account: string,
	area: RecordArea,
	view: AccessView,
): TransitionCheck {
	if (owner === account) return "allow";
	if (visibility !== "public") return "invalid";
	return editsPublic(account, area, view) ? "allow" : "forbidden";
}

/** Whether `account` may edit or delete another's public record of `area`: its area allows it, and `write`. */
function editsPublic(account: string, area: RecordArea, view: AccessView): boolean {
	return area.policy.publicEditable && reaches(grantOf(view, account, area.id), "write");
}

/**
 * The records of `table`, of `area`, that `account` may edit or delete: the rule {@link checkTransition} checks,
 * as a predicate. Its own, and the public ones where {@link editsPublic}.
 */
export function editableTo(
	table: OwnedTable,
	account: string,
	area: RecordArea,
	view: AccessView,
): SQL {
	return editsPublic(account, area, view) ? visibleTo(table, account) : eq(table.owner, account);
}

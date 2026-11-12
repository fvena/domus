// Who sees an owned record and what a new one takes (ADR 0010, ADR 0023). The decision does not filter row by
// row: handlers put this predicate in their queries, and the write capture checks the same rules.
import type { NewOwnership, OwnedTable, Visibility } from "@domus/module-sdk";
import { eq, or, type SQL } from "drizzle-orm";

/** The records of `table` that `account` sees: its own, and the public ones. */
export function visibleTo(table: OwnedTable, account: string): SQL {
	const predicate = or(eq(table.owner, account), eq(table.visibility, "public"));
	// `or` of two conditions always builds one; drizzle's type allows for an empty list.
	if (!predicate) throw new Error("no visibility predicate");
	return predicate;
}

/** A new record belongs to the represented account, with the default visibility of its area. */
export function newOwnership(account: string, defaultVisibility: Visibility): NewOwnership {
	return { owner: account, visibility: defaultVisibility };
}

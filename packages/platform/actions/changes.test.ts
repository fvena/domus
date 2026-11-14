// What a write remembers of the records it changed (spec of phase 1d4, «Lo que la escritura recuerda»): per record,
// its area, its first state before the write and its last after it, from the transitions of the capture in order.
import type { Visibility } from "@domus/module-sdk";
import { describe, expect, it } from "vitest";

import type { AreaPolicy } from "../authorization";
import { type CapturedTable, type CapturedTransition, changesOf } from "./capture";

const POLICY: AreaPolicy = {
	defaultVisibility: "private",
	publicEditable: false,
	alwaysPrivate: false,
	confirmOnSharedDevice: false,
};
const tasks: CapturedTable = {
	module: "chores",
	type: "task",
	area: { id: "chores", policy: POLICY },
};
const posts: CapturedTable = {
	module: "chores",
	type: "post",
	area: { id: "chores.board", policy: POLICY },
};

type Row = readonly [owner: string, visibility: Visibility];

function insert(table: CapturedTable, id: number, [owner, visibility]: Row): CapturedTransition {
	return {
		table,
		operation: "insert",
		oldId: null,
		newId: id,
		oldOwner: null,
		newOwner: owner,
		oldVisibility: null,
		newVisibility: visibility,
	};
}

function update(table: CapturedTable, id: number, from: Row, to: Row): CapturedTransition {
	return {
		table,
		operation: "update",
		oldId: id,
		newId: id,
		oldOwner: from[0],
		newOwner: to[0],
		oldVisibility: from[1],
		newVisibility: to[1],
	};
}

function remove(table: CapturedTable, id: number, [owner, visibility]: Row): CapturedTransition {
	return {
		table,
		operation: "delete",
		oldId: id,
		newId: null,
		oldOwner: owner,
		newOwner: null,
		oldVisibility: visibility,
		newVisibility: null,
	};
}

const anaPrivate: Row = ["ana", "private"];
const anaPublic: Row = ["ana", "public"];
const privateState = { owner: "ana", visibility: "private" };
const publicState = { owner: "ana", visibility: "public" };

describe("the changes of a write", () => {
	it("are none for a write that changed no owned record", () => {
		expect(changesOf([])).toEqual([]);
	});

	it("keep a created record without a before, and a deleted one without an after", () => {
		expect(changesOf([insert(tasks, 1, anaPrivate), remove(tasks, 2, anaPublic)])).toEqual([
			{
				module: "chores",
				type: "task",
				id: 1,
				area: "chores",
				before: null,
				after: privateState,
			},
			{
				module: "chores",
				type: "task",
				id: 2,
				area: "chores",
				before: publicState,
				after: null,
			},
		]);
	});

	it("keep the first before and the last after of a record, never a state in between", () => {
		expect(
			changesOf([
				update(tasks, 1, anaPrivate, anaPublic),
				update(tasks, 1, anaPublic, anaPrivate),
			]),
		).toEqual([
			{
				module: "chores",
				type: "task",
				id: 1,
				area: "chores",
				before: privateState,
				after: privateState,
			},
		]);
		expect(changesOf([insert(tasks, 3, anaPublic), remove(tasks, 3, anaPublic)])).toEqual([
			{ module: "chores", type: "task", id: 3, area: "chores", before: null, after: null },
		]);
		expect(changesOf([remove(tasks, 4, anaPublic), insert(tasks, 4, anaPrivate)])).toEqual([
			{
				module: "chores",
				type: "task",
				id: 4,
				area: "chores",
				before: publicState,
				after: privateState,
			},
		]);
	});

	it("tell apart records of different types with the same id, each once, in the order first seen", () => {
		expect(
			changesOf([
				insert(posts, 1, anaPublic),
				insert(tasks, 1, anaPrivate),
				update(posts, 1, anaPublic, anaPrivate),
			]),
		).toEqual([
			{
				module: "chores",
				type: "post",
				id: 1,
				area: "chores.board",
				before: null,
				after: privateState,
			},
			{
				module: "chores",
				type: "task",
				id: 1,
				area: "chores",
				before: null,
				after: privateState,
			},
		]);
	});
});

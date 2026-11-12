import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createTestPlatform } from "@domus/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import probe from "../server";
import { comments, notes } from "../server/schema";

/** A platform with probe, and Ana writing through Kira. */
function probePlatform(file?: string) {
	const test = createTestPlatform({ modules: [probe], file });
	return { test, ana: test.actor("ana", { via: "kira" }) };
}

const keyReused = expect.objectContaining({ code: "CONFLICT", data: { reason: "key-reused" } });

describe("probe idempotency", () => {
	it("answers a retry with an acknowledgement of its entry, without content and without running the write again", async () => {
		const { test, ana } = probePlatform();
		await using _ = test;

		const first = test.invoke(
			ana,
			"probe.addNote",
			{ body: "comprar pan" },
			{ idempotencyKey: "k1" },
		);
		const retry = test.invoke(
			ana,
			"probe.addNote",
			{ body: "comprar pan" },
			{ idempotencyKey: "k1" },
		);

		expect(first).toEqual({ result: { id: 1, body: "comprar pan" }, entry: 1 });
		expect(retry).toStrictEqual({ entry: 1, repeated: true });
		expect(test.invoke(ana, "probe.listNotes")).toEqual([{ id: 1, body: "comprar pan" }]);
		expect(test.log()).toHaveLength(1);
	});

	it("acknowledges a retry of a write undone since, without running it again", async () => {
		const { test, ana } = probePlatform();
		await using _ = test;
		test.invoke(ana, "probe.addNote", { body: "comprar pan" }, { idempotencyKey: "k1" });
		test.undo(ana, 1, { idempotencyKey: "u1" });

		expect(
			test.invoke(ana, "probe.addNote", { body: "comprar pan" }, { idempotencyKey: "k1" }),
		).toStrictEqual({ entry: 1, repeated: true });
		expect(test.invoke(ana, "probe.listNotes")).toEqual([]);
		expect(test.log()).toHaveLength(2);
	});

	it("answers key-reused when the same key comes with another action, without change or entry", async () => {
		const { test, ana } = probePlatform();
		await using _ = test;
		test.invoke(ana, "probe.addNote", { body: "comprar pan" }, { idempotencyKey: "k1" });

		expect(() =>
			test.invoke(ana, "probe.deleteNote", { id: 1 }, { idempotencyKey: "k1" }),
		).toThrow(keyReused);
		expect(test.invoke(ana, "probe.listNotes")).toEqual([{ id: 1, body: "comprar pan" }]);
		expect(test.log()).toHaveLength(1);
	});

	it("answers key-reused when the same key comes with another input, without change or entry", async () => {
		const { test, ana } = probePlatform();
		await using _ = test;
		test.invoke(ana, "probe.addNote", { body: "comprar pan" }, { idempotencyKey: "k1" });

		expect(() =>
			test.invoke(ana, "probe.addNote", { body: "comprar leche" }, { idempotencyKey: "k1" }),
		).toThrow(keyReused);
		expect(test.invoke(ana, "probe.listNotes")).toEqual([{ id: 1, body: "comprar pan" }]);
		expect(test.log()).toHaveLength(1);
	});

	it("takes the same input with its properties in another order as the same request", async () => {
		const { test, ana } = probePlatform();
		await using _ = test;
		test.invoke(ana, "probe.addNote", { body: "comprar pan" }, { idempotencyKey: "k1" });
		test.invoke(
			ana,
			"probe.editNote",
			{ id: 1, body: "comprar leche" },
			{ idempotencyKey: "k2" },
		);

		expect(
			test.invoke(
				ana,
				"probe.editNote",
				{ body: "comprar leche", id: 1 },
				{ idempotencyKey: "k2" },
			),
		).toStrictEqual({ entry: 2, repeated: true });
		expect(test.log()).toHaveLength(2);
	});

	it("runs the same key as another operation for another account, another via or no via", async () => {
		const { test, ana } = probePlatform();
		await using _ = test;
		const actors = [
			ana,
			test.actor("luis", { via: "kira" }),
			test.actor("ana", { via: "web" }),
			test.actor("ana"),
		];

		const entries = actors.map(
			(actor) =>
				test.invoke(actor, "probe.addNote", { body: "regar" }, { idempotencyKey: "k1" })
					.entry,
		);

		expect(entries).toEqual([1, 2, 3, 4]);
		expect(test.invoke(ana, "probe.listNotes")).toHaveLength(4);
	});

	it("runs a key again after an attempt with it rolled back", async () => {
		const { test, ana } = probePlatform();
		await using _ = test;
		test.dbFor(probe).insert(notes).values({ body: "comprar pan" }).run();
		test.dbFor(probe).insert(comments).values({ noteId: 1, body: "integral" }).run();
		expect(() =>
			test.invoke(ana, "probe.deleteNote", { id: 1 }, { idempotencyKey: "k1" }),
		).toThrow(expect.objectContaining({ code: "NOTE_HAS_COMMENTS" }));
		test.dbFor(probe).delete(comments).run();

		expect(test.invoke(ana, "probe.deleteNote", { id: 1 }, { idempotencyKey: "k1" })).toEqual({
			result: { id: 1, body: "comprar pan" },
			entry: 1,
		});
		expect(test.invoke(ana, "probe.listNotes")).toEqual([]);
	});

	it.each([
		["denies", () => "deny" as const],
		[
			"throws",
			() => {
				throw new Error("authorizer down");
			},
		],
	])("delivers nothing on a retry when the authorizer now %s", async (_, authorizer) => {
		const { test, ana } = probePlatform();
		await using __ = test;
		test.invoke(ana, "probe.addNote", { body: "comprar pan" }, { idempotencyKey: "k1" });

		test.authorize(authorizer);

		expect(() =>
			test.invoke(ana, "probe.addNote", { body: "comprar pan" }, { idempotencyKey: "k1" }),
		).toThrow(expect.objectContaining({ code: "FORBIDDEN" }));
		expect(test.log()).toHaveLength(1);
	});

	it("asks the authorizer again on a retry, with the request as it came", async () => {
		const { test, ana } = probePlatform();
		await using _ = test;
		test.invoke(ana, "probe.addNote", { body: "comprar pan" }, { idempotencyKey: "k1" });
		const requests: unknown[] = [];
		test.authorize((request) => {
			requests.push(request);
			return "allow";
		});

		test.invoke(ana, "probe.addNote", { body: "comprar pan" }, { idempotencyKey: "k1" });

		expect(requests).toEqual([
			{ actor: ana, action: "probe.addNote", input: { body: "comprar pan" } },
		]);
	});

	describe("on a file opened again", () => {
		let dir: string;
		beforeEach(() => {
			dir = mkdtempSync(join(tmpdir(), "domus-probe-"));
		});
		afterEach(() => rmSync(dir, { recursive: true, force: true }));

		it("acknowledges a key the closed platform already ran, without running it", async () => {
			const databaseFile = join(dir, "domus.db");
			const before = probePlatform(databaseFile);
			before.test.invoke(
				before.ana,
				"probe.addNote",
				{ body: "comprar pan" },
				{ idempotencyKey: "k1" },
			);
			before.test.close();

			const { test, ana } = probePlatform(databaseFile);
			await using _ = test;

			expect(
				test.invoke(
					ana,
					"probe.addNote",
					{ body: "comprar pan" },
					{ idempotencyKey: "k1" },
				),
			).toStrictEqual({ entry: 1, repeated: true });
			expect(test.invoke(ana, "probe.listNotes")).toEqual([{ id: 1, body: "comprar pan" }]);
			expect(test.log()).toHaveLength(1);
		});
	});
});

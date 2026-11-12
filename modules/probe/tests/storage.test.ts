import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq } from "@domus/module-sdk/db";
import { createTestPlatform } from "@domus/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import probe from "../server";
import { comments, notes } from "../server/schema";

describe("probe storage", () => {
	it("keeps the notes it is given, in memory", async () => {
		await using test = createTestPlatform({ modules: [probe] });
		const db = test.dbFor(probe);

		db.insert(notes).values({ body: "comprar pan" }).run();

		expect(db.select().from(notes).all()).toEqual([{ id: 1, body: "comprar pan" }]);
	});

	it("reads each comment with the note it belongs to", async () => {
		await using test = createTestPlatform({ modules: [probe] });
		const db = test.dbFor(probe);
		const note = db.insert(notes).values({ body: "cena del sábado" }).returning().get();

		db.insert(comments).values({ noteId: note.id, body: "llevo el postre" }).run();

		expect(
			db
				.select({ note: notes.body, comment: comments.body })
				.from(comments)
				.innerJoin(notes, eq(comments.noteId, notes.id))
				.all(),
		).toEqual([{ note: "cena del sábado", comment: "llevo el postre" }]);
	});

	it("rejects a comment on a note that does not exist", async () => {
		await using test = createTestPlatform({ modules: [probe] });
		const db = test.dbFor(probe);

		expect(() => db.insert(comments).values({ noteId: 99, body: "huérfano" }).run()).toThrow(
			/FOREIGN KEY constraint failed/,
		);
		expect(db.select().from(comments).all()).toEqual([]);
	});

	describe("on a file", () => {
		let dir: string;
		beforeEach(() => {
			dir = mkdtempSync(join(tmpdir(), "domus-probe-"));
		});
		afterEach(() => rmSync(dir, { recursive: true, force: true }));

		it("keeps notes and comments after closing and opening it again", async () => {
			const file = join(dir, "domus.db");
			{
				await using test = createTestPlatform({ modules: [probe], file });
				const db = test.dbFor(probe);
				const note = db
					.insert(notes)
					.values({ body: "regar las plantas" })
					.returning()
					.get();
				db.insert(comments).values({ noteId: note.id, body: "hecho" }).run();
			}

			await using test = createTestPlatform({ modules: [probe], file });
			const db = test.dbFor(probe);
			expect(test.platform.appliedMigrations).toBe(0);
			expect(db.select().from(notes).all()).toEqual([{ id: 1, body: "regar las plantas" }]);
			expect(db.select().from(comments).all()).toEqual([{ id: 1, noteId: 1, body: "hecho" }]);
		});
	});
});

import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { migrations } from "./migrations";

describe("the platform's migrations", () => {
	it.each(migrations)("$tag carries the hash of its statements", (migration) => {
		// What readMigrationFiles of drizzle-orm/migrator gives for the same SQL file.
		const file = migration.statements.join("--> statement-breakpoint");
		expect(migration.hash).toBe(createHash("sha256").update(file).digest("hex"));
	});

	it("are numbered from 0, in order", () => {
		expect(migrations.map((migration) => migration.position)).toEqual(
			migrations.map((_, index) => index),
		);
	});
});

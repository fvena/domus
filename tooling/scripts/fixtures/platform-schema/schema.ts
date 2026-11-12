// The platform's schema plus one table, so platform-migrations.test.ts has drizzle-kit generate a migration
// after the real base.
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export * from "../../../../packages/platform/schema";

export const sample = sqliteTable("platform_sample", {
	id: integer().primaryKey(),
	name: text().notNull(),
});

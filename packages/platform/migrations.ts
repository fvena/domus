// The platform's own migrations, in the shape a module's `server/migrations.ts` has (ADR 0021). They run
// before every module's. platform/0000 creates the history and is the first row written into it.
import type { ModuleMigration } from "@domus/module-sdk";

/** The name the platform's rows carry in `platform_migrations.module`; no module may take it. */
export const PLATFORM_MODULE = "platform";

export const migrations: readonly ModuleMigration[] = [
	{
		tag: "0000_migration_history",
		position: 0,
		// sha256 of the statements joined by drizzle-kit's `--> statement-breakpoint`, as
		// readMigrationFiles hashes a file; migrations.test.ts keeps the two in step.
		hash: "512cefbbc430893d8f533b2e3fc1daddf2a465ec89ac78cf8a7566958d5d3172",
		statements: [
			"CREATE TABLE `platform_migrations` (\n\t`module` text NOT NULL,\n\t`position` integer NOT NULL,\n\t`tag` text NOT NULL,\n\t`hash` text NOT NULL,\n\t`applied_at` integer NOT NULL,\n\tPRIMARY KEY(`module`, `position`)\n);\n",
			"\nCREATE UNIQUE INDEX `platform_migrations_module_tag_unique` ON `platform_migrations` (`module`,`tag`);",
		],
	},
];

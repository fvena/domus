// The platform's own migrations, in the shape a module's `server/migrations.ts` has (ADR 0021). They run
// before every module's. platform/0000 creates the history and is the first row written into it; platform/0001
// creates the action log.
import type { ModuleMigration } from "@domus/module-sdk";

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
	{
		// The action log (ADR 0022), which platform/audit reads and writes with prepared statements. Each entry
		// has its annotation (entry number, action, actor, key, fingerprint, instants, undo links) and its
		// content (input, result, inverse, as JSON); the records it touched live apart, indexed by record so
		// undo finds the later entries that touched the same one. The key is unique per account and via, with
		// no via as a value of its own: `via IS NULL` tells it apart from an empty via.
		tag: "0001_action_log",
		position: 1,
		hash: "1cf2a3b8dcb614d8d90e2277a6c2c4aec50ad22d958982f51e48a0a5169eea40",
		statements: [
			"CREATE TABLE `platform_action_log` (\n\t`entry` integer PRIMARY KEY AUTOINCREMENT NOT NULL,\n\t`module` text NOT NULL,\n\t`action` text NOT NULL,\n\t`account` text NOT NULL,\n\t`via` text,\n\t`key` text NOT NULL,\n\t`fingerprint` text NOT NULL,\n\t`at` integer NOT NULL,\n\t`expires_at` integer NOT NULL,\n\t`undoes` integer REFERENCES `platform_action_log`(`entry`),\n\t`undone_by` integer REFERENCES `platform_action_log`(`entry`),\n\t`input` text,\n\t`result` text,\n\t`inverse` text\n);\n",
			"\nCREATE UNIQUE INDEX `platform_action_log_key_unique` ON `platform_action_log` (`account`,`via` IS NULL,ifnull(`via`, ''),`key`);",
			"\nCREATE TABLE `platform_action_log_touched` (\n\t`entry` integer NOT NULL REFERENCES `platform_action_log`(`entry`),\n\t`module` text NOT NULL,\n\t`type` text NOT NULL,\n\t`id` text NOT NULL,\n\tPRIMARY KEY(`entry`, `module`, `type`, `id`)\n);\n",
			"\nCREATE INDEX `platform_action_log_touched_record` ON `platform_action_log_touched` (`module`,`type`,`id`,`entry`);",
		],
	},
];

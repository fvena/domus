// Written by `pnpm db:generate` from `migrations/` (ADR 0021). Do not edit: change `schema.ts` and generate.
import type { ModuleMigration } from "@domus/module-sdk";

export const migrations: readonly ModuleMigration[] = [
	{
		tag: "0000_ambiguous_silver_centurion",
		position: 0,
		hash: "90952e02e133fd816bb5a8ab9eddc349e3d714a9f91fbf22760eafb336c259ed",
		statements: [
			"CREATE TABLE `probe_comments` (\n\t`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,\n\t`note_id` integer NOT NULL,\n\t`body` text NOT NULL,\n\tFOREIGN KEY (`note_id`) REFERENCES `probe_notes`(`id`) ON UPDATE no action ON DELETE no action\n);\n",
			"\nCREATE TABLE `probe_notes` (\n\t`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,\n\t`body` text NOT NULL\n);\n",
		],
	},
];

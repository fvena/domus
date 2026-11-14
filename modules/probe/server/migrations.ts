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
	{
		tag: "0001_broad_namor",
		position: 1,
		hash: "3c9483d2f0dffb21a0ea72dfb585209c076fa9c2f77a508d0356d231ccee863d",
		statements: [
			"CREATE TABLE `probe_board` (\n\t`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,\n\t`body` text NOT NULL,\n\t`owner` text NOT NULL,\n\t`visibility` text NOT NULL,\n\tCONSTRAINT \"probe_board_visibility\" CHECK(\"visibility\" in ('private', 'public'))\n);\n",
			'\nCREATE TABLE `probe_health` (\n\t`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,\n\t`body` text NOT NULL,\n\t`owner` text NOT NULL,\n\t`visibility` text NOT NULL,\n\tCONSTRAINT "probe_health_visibility" CHECK("visibility" = \'private\')\n);\n',
			'\nCREATE TABLE `probe_secret` (\n\t`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,\n\t`body` text NOT NULL,\n\t`owner` text NOT NULL,\n\t`visibility` text NOT NULL,\n\tCONSTRAINT "probe_secret_visibility" CHECK("visibility" = \'private\')\n);\n',
			"\nPRAGMA foreign_keys=OFF;",
			"\nCREATE TABLE `__new_probe_comments` (\n\t`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,\n\t`note_id` integer NOT NULL,\n\t`body` text NOT NULL,\n\t`owner` text NOT NULL,\n\t`visibility` text NOT NULL,\n\tFOREIGN KEY (`note_id`) REFERENCES `probe_notes`(`id`) ON UPDATE no action ON DELETE no action,\n\tCONSTRAINT \"probe_comments_visibility\" CHECK(\"visibility\" in ('private', 'public'))\n);\n",
			'\nINSERT INTO `__new_probe_comments`("id", "note_id", "body", "owner", "visibility") SELECT "id", "note_id", "body", \'\', \'private\' FROM `probe_comments`;',
			"\nDROP TABLE `probe_comments`;",
			"\nALTER TABLE `__new_probe_comments` RENAME TO `probe_comments`;",
			"\nPRAGMA foreign_keys=ON;",
			"\nCREATE TABLE `__new_probe_notes` (\n\t`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,\n\t`body` text NOT NULL,\n\t`owner` text NOT NULL,\n\t`visibility` text NOT NULL,\n\tCONSTRAINT \"probe_notes_visibility\" CHECK(\"visibility\" in ('private', 'public'))\n);\n",
			'\nINSERT INTO `__new_probe_notes`("id", "body", "owner", "visibility") SELECT "id", "body", \'\', \'private\' FROM `probe_notes`;',
			"\nDROP TABLE `probe_notes`;",
			"\nALTER TABLE `__new_probe_notes` RENAME TO `probe_notes`;",
		],
	},
	{
		tag: "0002_yellow_zodiak",
		position: 2,
		hash: "e4925f475d51e2a81b5102e7f26034136d86f5358564fa2ad49f82b1d3f98b70",
		statements: [
			"CREATE TABLE `probe_labels` (\n\t`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,\n\t`name` text NOT NULL\n);\n",
			"\nCREATE TABLE `probe_scraps` (\n\t`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,\n\t`body` text NOT NULL\n);\n",
		],
	},
];

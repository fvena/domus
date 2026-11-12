// Written by `pnpm db:generate` from `migrations/` (ADR 0021). Do not edit: change `schema.ts` and generate.
import type { ModuleMigration } from "@domus/module-sdk";

export const migrations: readonly ModuleMigration[] = [
	{
		tag: "0000_violet_loners",
		position: 0,
		hash: "055f09b3a6be39643d0c7507b97b4b605382b3d01a5c18337c18a5c8abdb7b2c",
		statements: [
			"CREATE TABLE `sample_notes` (\n\t`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,\n\t`body` text NOT NULL\n);\n",
		],
	},
	{
		tag: "0001_clean_bullseye",
		position: 1,
		hash: "19ead352e565322e1a3af3b696bb340d071ba6dc46d30878375fab50da74d531",
		statements: [
			"CREATE TABLE `sample_tags` (\n\t`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,\n\t`noteId` integer NOT NULL,\n\t`name` text NOT NULL,\n\tFOREIGN KEY (`noteId`) REFERENCES `sample_notes`(`id`) ON UPDATE no action ON DELETE no action\n);\n",
			"\nALTER TABLE `sample_notes` ADD `pinned` integer DEFAULT false NOT NULL;",
		],
	},
];

// Written by `pnpm db:generate` from `migrations/`, leaving out its base (ADR 0023). Do not edit: change
// `schema.ts` and generate.
import type { ModuleMigration } from "@domus/module-sdk";

export const generatedMigrations: readonly ModuleMigration[] = [
	{
		tag: "0001_lively_sharon_carter",
		position: 2,
		hash: "45fc89e93dbe3ce3adab1187fe68762b22c1e2ff74af1d5f9684cce8437d9606",
		statements: ["ALTER TABLE `platform_action_log` DROP COLUMN `result`;"],
	},
	{
		tag: "0002_milky_shen",
		position: 3,
		hash: "c031c0c34e6fd690356f04c195d8e8d362c439c123303f9292b4be929b498a54",
		statements: [
			"CREATE TABLE `platform_account` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`account_id` text NOT NULL,\n\t`provider_id` text NOT NULL,\n\t`user_id` text NOT NULL,\n\t`access_token` text,\n\t`refresh_token` text,\n\t`id_token` text,\n\t`access_token_expires_at` integer,\n\t`refresh_token_expires_at` integer,\n\t`scope` text,\n\t`password` text,\n\t`created_at` integer NOT NULL,\n\t`updated_at` integer NOT NULL,\n\tFOREIGN KEY (`user_id`) REFERENCES `platform_user`(`id`) ON UPDATE no action ON DELETE cascade\n);\n",
			"\nCREATE INDEX `platform_account_user` ON `platform_account` (`user_id`);",
			"\nCREATE TABLE `platform_devices` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`created_at` integer NOT NULL,\n\t`name` text\n);\n",
			"\nCREATE TABLE `platform_permissions` (\n\t`account` text NOT NULL,\n\t`area` text NOT NULL,\n\t`level` text NOT NULL,\n\tPRIMARY KEY(`account`, `area`),\n\tFOREIGN KEY (`account`) REFERENCES `platform_user`(`id`) ON UPDATE no action ON DELETE cascade,\n\tCONSTRAINT \"platform_permissions_level\" CHECK(\"platform_permissions\".\"level\" IN ('none', 'read', 'write', 'manage'))\n);\n",
			"\nCREATE TABLE `platform_roles` (\n\t`account` text PRIMARY KEY NOT NULL,\n\t`role` text NOT NULL,\n\tFOREIGN KEY (`account`) REFERENCES `platform_user`(`id`) ON UPDATE no action ON DELETE cascade,\n\tCONSTRAINT \"platform_roles_role\" CHECK(\"platform_roles\".\"role\" IN ('admin', 'member', 'device'))\n);\n",
			'\nCREATE UNIQUE INDEX `platform_roles_one_device` ON `platform_roles` (`role`) WHERE "platform_roles"."role" = \'device\';',
			"\nCREATE TABLE `platform_session` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`user_id` text NOT NULL,\n\t`device_id` text NOT NULL,\n\t`token` text NOT NULL,\n\t`expires_at` integer NOT NULL,\n\t`ip_address` text,\n\t`user_agent` text,\n\t`created_at` integer NOT NULL,\n\t`updated_at` integer NOT NULL,\n\tFOREIGN KEY (`user_id`) REFERENCES `platform_user`(`id`) ON UPDATE no action ON DELETE cascade,\n\tFOREIGN KEY (`device_id`) REFERENCES `platform_devices`(`id`) ON UPDATE no action ON DELETE no action\n);\n",
			"\nCREATE UNIQUE INDEX `platform_session_token_unique` ON `platform_session` (`token`);",
			"\nCREATE INDEX `platform_session_user` ON `platform_session` (`user_id`);",
			"\nCREATE TABLE `platform_user` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`name` text NOT NULL,\n\t`email` text NOT NULL,\n\t`email_verified` integer DEFAULT false NOT NULL,\n\t`image` text,\n\t`created_at` integer NOT NULL,\n\t`updated_at` integer NOT NULL\n);\n",
			"\nCREATE UNIQUE INDEX `platform_user_email_unique` ON `platform_user` (`email`);",
			"\nCREATE TABLE `platform_verification` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`identifier` text NOT NULL,\n\t`value` text NOT NULL,\n\t`expires_at` integer NOT NULL,\n\t`created_at` integer NOT NULL,\n\t`updated_at` integer NOT NULL\n);\n",
		],
	},
	{
		tag: "0003_open_tarot",
		position: 4,
		hash: "63428318e310939780db4d66dd5151078a94156c3ff171e810147d7bb1ad9b90",
		statements: [
			"CREATE TABLE `platform_delegation` (\n\t`account` text NOT NULL,\n\t`area` text NOT NULL,\n\t`level` text NOT NULL,\n\t`value` text NOT NULL,\n\tPRIMARY KEY(`account`, `area`, `level`),\n\tFOREIGN KEY (`account`) REFERENCES `platform_user`(`id`) ON UPDATE no action ON DELETE cascade,\n\tCONSTRAINT \"platform_delegation_level\" CHECK(\"platform_delegation\".\"level\" IN ('read', 'write', 'manage')),\n\tCONSTRAINT \"platform_delegation_value\" CHECK(\"platform_delegation\".\"value\" IN ('no', 'yes', 'confirm'))\n);\n",
		],
	},
	{
		tag: "0004_vengeful_the_leader",
		position: 5,
		hash: "b6a4e3aeb74f6f2b9e5975c4fa18faf76cf3a1467d23ada763a422485a994ec3",
		statements: [
			"CREATE TABLE `platform_confirmations` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`account` text NOT NULL,\n\t`via` text,\n\t`kind` text NOT NULL,\n\t`operation` text NOT NULL,\n\t`fingerprint` text NOT NULL,\n\t`key` text,\n\t`origin` text NOT NULL,\n\t`session` text,\n\t`bound` integer NOT NULL,\n\t`created_at` integer NOT NULL,\n\t`window_closes_at` integer NOT NULL,\n\t`expires_at` integer NOT NULL,\n\t`state` text NOT NULL,\n\t`entry` integer,\n\tFOREIGN KEY (`account`) REFERENCES `platform_user`(`id`) ON UPDATE no action ON DELETE cascade,\n\tFOREIGN KEY (`session`) REFERENCES `platform_session`(`id`) ON UPDATE no action ON DELETE set null,\n\tFOREIGN KEY (`entry`) REFERENCES `platform_action_log`(`entry`) ON UPDATE no action ON DELETE no action,\n\tCONSTRAINT \"platform_confirmations_kind\" CHECK(\"platform_confirmations\".\"kind\" IN ('read', 'write')),\n\tCONSTRAINT \"platform_confirmations_state\" CHECK(\"platform_confirmations\".\"state\" IN ('pending', 'consumed', 'rejected', 'ended'))\n);\n",
			"\nCREATE INDEX `platform_confirmations_account_key` ON `platform_confirmations` (`account`,`key`);",
			"\nCREATE INDEX `platform_confirmations_session` ON `platform_confirmations` (`session`);",
		],
	},
];

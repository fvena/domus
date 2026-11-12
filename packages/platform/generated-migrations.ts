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
	{
		tag: "0005_perfect_ultragirl",
		position: 6,
		hash: "1ac2aeb77d2324cb4ef0976c2d7592fc3b0120d658bd6291c7a338616878bc75",
		statements: [
			"CREATE TABLE `platform_proofs` (\n\t`hash` text PRIMARY KEY NOT NULL,\n\t`account` text NOT NULL,\n\t`session` text,\n\t`origin_session` text,\n\t`bound` integer NOT NULL,\n\t`device` text NOT NULL,\n\t`fingerprint` text NOT NULL,\n\t`created_at` integer NOT NULL,\n\t`expires_at` integer NOT NULL,\n\t`state` text NOT NULL,\n\t`entry` integer,\n\tFOREIGN KEY (`account`) REFERENCES `platform_user`(`id`) ON UPDATE no action ON DELETE cascade,\n\tFOREIGN KEY (`session`) REFERENCES `platform_session`(`id`) ON UPDATE no action ON DELETE set null,\n\tFOREIGN KEY (`entry`) REFERENCES `platform_action_log`(`entry`) ON UPDATE no action ON DELETE no action,\n\tCONSTRAINT \"platform_proofs_state\" CHECK(\"platform_proofs\".\"state\" IN ('issued', 'used', 'ended'))\n);\n",
			"\nCREATE INDEX `platform_proofs_account` ON `platform_proofs` (`account`);",
			"\nCREATE INDEX `platform_proofs_session` ON `platform_proofs` (`session`);",
			"\nCREATE INDEX `platform_proofs_device` ON `platform_proofs` (`device`);",
		],
	},
	{
		tag: "0006_outstanding_star_brand",
		position: 7,
		hash: "f65af8e5dc5320eec0c0dbfdb10ed5edc37d611816bc1a707f2a1310e2493dd8",
		statements: [
			"ALTER TABLE `platform_confirmations` ADD `context_only` integer DEFAULT false NOT NULL;",
		],
	},
	{
		tag: "0007_aspiring_kabuki",
		position: 8,
		hash: "68167f32d0e02d304f510bd74cb2eef7fc24de8c0122bf3f489c298ef95535a3",
		statements: [
			"CREATE TABLE `platform_jobs` (\n\t`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,\n\t`kind` text NOT NULL,\n\t`lane` text NOT NULL,\n\t`state` text NOT NULL,\n\t`attempts` integer DEFAULT 0 NOT NULL,\n\t`run_at` integer NOT NULL,\n\t`task_run` integer,\n\t`created_at` integer NOT NULL,\n\t`started_at` integer,\n\t`finished_at` integer,\n\t`error` text,\n\tFOREIGN KEY (`task_run`) REFERENCES `platform_task_runs`(`id`) ON UPDATE no action ON DELETE no action,\n\tCONSTRAINT \"platform_jobs_lane\" CHECK(\"platform_jobs\".\"lane\" IN ('short', 'maintenance')),\n\tCONSTRAINT \"platform_jobs_state\" CHECK(\"platform_jobs\".\"state\" IN ('pending', 'running', 'done', 'failed', 'cancelled', 'stuck'))\n);\n",
			"\nCREATE INDEX `platform_jobs_due` ON `platform_jobs` (`lane`,`state`,`run_at`);",
			"\nCREATE INDEX `platform_jobs_task_run` ON `platform_jobs` (`task_run`);",
			"\nCREATE TABLE `platform_task_runs` (\n\t`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,\n\t`task` text NOT NULL,\n\t`planned_date` text,\n\t`planned_at` integer NOT NULL,\n\t`started_at` integer,\n\t`finished_at` integer,\n\t`result` text,\n\t`error` text,\n\tCONSTRAINT \"platform_task_runs_result\" CHECK(\"platform_task_runs\".\"result\" IN ('ok', 'failed', 'cancelled', 'stuck', 'skipped'))\n);\n",
			"\nCREATE UNIQUE INDEX `platform_task_runs_planned` ON `platform_task_runs` (`task`,`planned_date`);",
			"\nCREATE TABLE `platform_tasks` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`time` text,\n\t`paused` integer DEFAULT false NOT NULL,\n\t`next_at` integer NOT NULL\n);\n",
		],
	},
	{
		tag: "0008_bumpy_ultimates",
		position: 9,
		hash: "583be68e7add1f7a2c46bc658adba1e6fd704f55dfe86b2d69bd9ae702a9d17f",
		statements: [
			"PRAGMA foreign_keys=OFF;",
			"\nCREATE TABLE `__new_platform_confirmations` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`account` text NOT NULL,\n\t`via` text,\n\t`kind` text NOT NULL,\n\t`operation` text,\n\t`fingerprint` text NOT NULL,\n\t`key` text,\n\t`origin` text NOT NULL,\n\t`session` text,\n\t`bound` integer NOT NULL,\n\t`created_at` integer NOT NULL,\n\t`window_closes_at` integer NOT NULL,\n\t`expires_at` integer NOT NULL,\n\t`context_only` integer DEFAULT false NOT NULL,\n\t`state` text NOT NULL,\n\t`entry` integer,\n\tFOREIGN KEY (`account`) REFERENCES `platform_user`(`id`) ON UPDATE no action ON DELETE cascade,\n\tFOREIGN KEY (`session`) REFERENCES `platform_session`(`id`) ON UPDATE no action ON DELETE set null,\n\tFOREIGN KEY (`entry`) REFERENCES `platform_action_log`(`entry`) ON UPDATE no action ON DELETE no action,\n\tCONSTRAINT \"platform_confirmations_kind\" CHECK(\"__new_platform_confirmations\".\"kind\" IN ('read', 'write')),\n\tCONSTRAINT \"platform_confirmations_state\" CHECK(\"__new_platform_confirmations\".\"state\" IN ('pending', 'consumed', 'rejected', 'ended'))\n);\n",
			'\nINSERT INTO `__new_platform_confirmations`("id", "account", "via", "kind", "operation", "fingerprint", "key", "origin", "session", "bound", "created_at", "window_closes_at", "expires_at", "context_only", "state", "entry") SELECT "id", "account", "via", "kind", "operation", "fingerprint", "key", "origin", "session", "bound", "created_at", "window_closes_at", "expires_at", "context_only", "state", "entry" FROM `platform_confirmations`;',
			"\nDROP TABLE `platform_confirmations`;",
			"\nALTER TABLE `__new_platform_confirmations` RENAME TO `platform_confirmations`;",
			"\nPRAGMA foreign_keys=ON;",
			"\nCREATE INDEX `platform_confirmations_account_key` ON `platform_confirmations` (`account`,`key`);",
			"\nCREATE INDEX `platform_confirmations_session` ON `platform_confirmations` (`session`);",
		],
	},
	{
		tag: "0009_new_thanos",
		position: 10,
		hash: "31e16b6beba99387d7aa754c80113f19887406e23e0ce4d8ef0e2f72f20deeb0",
		statements: [
			"PRAGMA foreign_keys=OFF;",
			"\nCREATE TABLE `__new_platform_task_runs` (\n\t`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,\n\t`task` text NOT NULL,\n\t`planned_date` text,\n\t`planned_at` integer NOT NULL,\n\t`started_at` integer,\n\t`finished_at` integer,\n\t`result` text,\n\t`error` text,\n\tCONSTRAINT \"platform_task_runs_result\" CHECK(\"__new_platform_task_runs\".\"result\" IN ('ok', 'failed', 'cancelled', 'skipped'))\n);\n",
			'\nINSERT INTO `__new_platform_task_runs`("id", "task", "planned_date", "planned_at", "started_at", "finished_at", "result", "error") SELECT "id", "task", "planned_date", "planned_at", "started_at", "finished_at", "result", "error" FROM `platform_task_runs`;',
			"\nDROP TABLE `platform_task_runs`;",
			"\nALTER TABLE `__new_platform_task_runs` RENAME TO `platform_task_runs`;",
			"\nPRAGMA foreign_keys=ON;",
			"\nCREATE UNIQUE INDEX `platform_task_runs_planned` ON `platform_task_runs` (`task`,`planned_date`);",
		],
	},
	{
		tag: "0010_numerous_bromley",
		position: 11,
		hash: "4031656eb81cf2c5a7c0aaf4db099fb8fbc2312b3f25ef2f24d20745f81ff0fe",
		statements: [
			'CREATE TABLE `platform_backup_marks` (\n\t`id` integer PRIMARY KEY NOT NULL,\n\t`saved_captured_at` integer,\n\t`saved_snapshot` text,\n\t`failed_at` integer,\n\t`retention_at` integer,\n\t`retention_result` text,\n\t`check_at` integer,\n\t`check_result` text,\n\t`restored_snapshot` text,\n\t`restored_captured_at` integer,\n\t`restored_at` integer,\n\tCONSTRAINT "platform_backup_marks_one_row" CHECK("platform_backup_marks"."id" = 1),\n\tCONSTRAINT "platform_backup_marks_retention_result" CHECK("platform_backup_marks"."retention_result" IN (\'ok\', \'failed\')),\n\tCONSTRAINT "platform_backup_marks_check_result" CHECK("platform_backup_marks"."check_result" IN (\'ok\', \'failed\'))\n);\n',
		],
	},
];

CREATE TABLE `platform_backup_marks` (
	`id` integer PRIMARY KEY NOT NULL,
	`saved_captured_at` integer,
	`saved_snapshot` text,
	`failed_at` integer,
	`retention_at` integer,
	`retention_result` text,
	`check_at` integer,
	`check_result` text,
	`restored_snapshot` text,
	`restored_captured_at` integer,
	`restored_at` integer,
	CONSTRAINT "platform_backup_marks_one_row" CHECK("platform_backup_marks"."id" = 1),
	CONSTRAINT "platform_backup_marks_retention_result" CHECK("platform_backup_marks"."retention_result" IN ('ok', 'failed')),
	CONSTRAINT "platform_backup_marks_check_result" CHECK("platform_backup_marks"."check_result" IN ('ok', 'failed'))
);

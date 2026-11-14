CREATE TABLE `platform_file_contents` (
	`hash` text PRIMARY KEY NOT NULL,
	`size` integer NOT NULL,
	`type` text NOT NULL,
	`state` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "platform_file_contents_type" CHECK("platform_file_contents"."type" IN ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf', 'text/plain')),
	CONSTRAINT "platform_file_contents_state" CHECK("platform_file_contents"."state" IN ('present', 'claimed'))
);
--> statement-breakpoint
CREATE TABLE `platform_file_references` (
	`id` text PRIMARY KEY NOT NULL,
	`content` text NOT NULL,
	`name` text NOT NULL,
	`module` text NOT NULL,
	`record_table` text NOT NULL,
	`record_id` integer NOT NULL,
	`released_by` integer,
	FOREIGN KEY (`content`) REFERENCES `platform_file_contents`(`hash`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`released_by`) REFERENCES `platform_action_log`(`entry`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `platform_file_references_record` ON `platform_file_references` (`module`,`record_table`,`record_id`);--> statement-breakpoint
CREATE INDEX `platform_file_references_content` ON `platform_file_references` (`content`);--> statement-breakpoint
CREATE INDEX `platform_file_references_released_by` ON `platform_file_references` (`released_by`);--> statement-breakpoint
CREATE TABLE `platform_prepared_files` (
	`id` text PRIMARY KEY NOT NULL,
	`content` text NOT NULL,
	`name` text NOT NULL,
	`session` text NOT NULL,
	`account` text NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`content`) REFERENCES `platform_file_contents`(`hash`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `platform_prepared_files_session` ON `platform_prepared_files` (`session`);--> statement-breakpoint
CREATE INDEX `platform_prepared_files_content` ON `platform_prepared_files` (`content`);
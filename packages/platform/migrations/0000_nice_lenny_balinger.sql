CREATE TABLE `platform_action_log` (
	`entry` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`module` text NOT NULL,
	`action` text NOT NULL,
	`account` text NOT NULL,
	`via` text,
	`key` text NOT NULL,
	`fingerprint` text NOT NULL,
	`at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`undoes` integer,
	`undone_by` integer,
	`input` text,
	`result` text,
	`inverse` text,
	FOREIGN KEY (`undoes`) REFERENCES `platform_action_log`(`entry`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`undone_by`) REFERENCES `platform_action_log`(`entry`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `platform_action_log_key_unique` ON `platform_action_log` (`account`,"via" IS NULL,ifnull("via", ''),`key`);--> statement-breakpoint
CREATE TABLE `platform_action_log_touched` (
	`entry` integer NOT NULL,
	`module` text NOT NULL,
	`type` text NOT NULL,
	`id` text NOT NULL,
	PRIMARY KEY(`entry`, `module`, `type`, `id`),
	FOREIGN KEY (`entry`) REFERENCES `platform_action_log`(`entry`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `platform_action_log_touched_record` ON `platform_action_log_touched` (`module`,`type`,`id`,`entry`);--> statement-breakpoint
CREATE TABLE `platform_migrations` (
	`module` text NOT NULL,
	`position` integer NOT NULL,
	`tag` text NOT NULL,
	`hash` text NOT NULL,
	`applied_at` integer NOT NULL,
	PRIMARY KEY(`module`, `position`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `platform_migrations_module_tag_unique` ON `platform_migrations` (`module`,`tag`);
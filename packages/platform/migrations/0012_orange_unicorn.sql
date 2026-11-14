ALTER TABLE `platform_jobs` ADD `payload` text;--> statement-breakpoint
ALTER TABLE `platform_jobs` ADD `entry` integer REFERENCES platform_action_log(entry);--> statement-breakpoint
ALTER TABLE `platform_jobs` ADD `outcome` text;--> statement-breakpoint
CREATE INDEX `platform_jobs_entry` ON `platform_jobs` (`entry`);
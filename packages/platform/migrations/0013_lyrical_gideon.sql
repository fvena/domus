CREATE TABLE `platform_push_keys` (
	`id` integer PRIMARY KEY NOT NULL,
	`public_key` text NOT NULL,
	`private_key` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "platform_push_keys_one_row" CHECK("platform_push_keys"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE `platform_push_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`device` text NOT NULL,
	`session` text NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`device`) REFERENCES `platform_devices`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session`) REFERENCES `platform_session`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `platform_push_subscriptions_device_unique` ON `platform_push_subscriptions` (`device`);--> statement-breakpoint
CREATE UNIQUE INDEX `platform_push_subscriptions_endpoint_unique` ON `platform_push_subscriptions` (`endpoint`);--> statement-breakpoint
CREATE INDEX `platform_push_subscriptions_session` ON `platform_push_subscriptions` (`session`);--> statement-breakpoint
ALTER TABLE `platform_devices` ADD `entry` text;--> statement-breakpoint
ALTER TABLE `platform_session` ADD `device_entry` text;
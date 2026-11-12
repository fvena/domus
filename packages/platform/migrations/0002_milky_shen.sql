CREATE TABLE `platform_account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `platform_user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `platform_account_user` ON `platform_account` (`user_id`);--> statement-breakpoint
CREATE TABLE `platform_devices` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`name` text
);
--> statement-breakpoint
CREATE TABLE `platform_permissions` (
	`account` text NOT NULL,
	`area` text NOT NULL,
	`level` text NOT NULL,
	PRIMARY KEY(`account`, `area`),
	FOREIGN KEY (`account`) REFERENCES `platform_user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "platform_permissions_level" CHECK("platform_permissions"."level" IN ('none', 'read', 'write', 'manage'))
);
--> statement-breakpoint
CREATE TABLE `platform_roles` (
	`account` text PRIMARY KEY NOT NULL,
	`role` text NOT NULL,
	FOREIGN KEY (`account`) REFERENCES `platform_user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "platform_roles_role" CHECK("platform_roles"."role" IN ('admin', 'member', 'device'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `platform_roles_one_device` ON `platform_roles` (`role`) WHERE "platform_roles"."role" = 'device';--> statement-breakpoint
CREATE TABLE `platform_session` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`device_id` text NOT NULL,
	`token` text NOT NULL,
	`expires_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `platform_user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`device_id`) REFERENCES `platform_devices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `platform_session_token_unique` ON `platform_session` (`token`);--> statement-breakpoint
CREATE INDEX `platform_session_user` ON `platform_session` (`user_id`);--> statement-breakpoint
CREATE TABLE `platform_user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `platform_user_email_unique` ON `platform_user` (`email`);--> statement-breakpoint
CREATE TABLE `platform_verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);

CREATE TABLE `platform_mandates` (
	`hash` text PRIMARY KEY NOT NULL,
	`app` text NOT NULL,
	`account` text NOT NULL,
	`device` text NOT NULL,
	`session` text NOT NULL,
	`device_account` text NOT NULL,
	`identity` text NOT NULL,
	`conversation` text,
	`issued_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`account`) REFERENCES `platform_user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "platform_mandates_identity" CHECK("platform_mandates"."identity" IN ('password', 'voice', 'device'))
);

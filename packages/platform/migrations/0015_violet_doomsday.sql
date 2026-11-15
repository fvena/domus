CREATE TABLE `platform_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`app` text NOT NULL,
	`secret_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	`revoked_at` integer
);

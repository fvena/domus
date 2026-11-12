CREATE TABLE `platform_proofs` (
	`hash` text PRIMARY KEY NOT NULL,
	`account` text NOT NULL,
	`session` text,
	`origin_session` text,
	`bound` integer NOT NULL,
	`device` text NOT NULL,
	`fingerprint` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`state` text NOT NULL,
	`entry` integer,
	FOREIGN KEY (`account`) REFERENCES `platform_user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session`) REFERENCES `platform_session`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`entry`) REFERENCES `platform_action_log`(`entry`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "platform_proofs_state" CHECK("platform_proofs"."state" IN ('issued', 'used', 'ended'))
);
--> statement-breakpoint
CREATE INDEX `platform_proofs_account` ON `platform_proofs` (`account`);--> statement-breakpoint
CREATE INDEX `platform_proofs_session` ON `platform_proofs` (`session`);--> statement-breakpoint
CREATE INDEX `platform_proofs_device` ON `platform_proofs` (`device`);
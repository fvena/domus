PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_platform_confirmations` (
	`id` text PRIMARY KEY NOT NULL,
	`account` text NOT NULL,
	`via` text,
	`kind` text NOT NULL,
	`operation` text,
	`fingerprint` text NOT NULL,
	`key` text,
	`origin` text NOT NULL,
	`session` text,
	`bound` integer NOT NULL,
	`created_at` integer NOT NULL,
	`window_closes_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`context_only` integer DEFAULT false NOT NULL,
	`state` text NOT NULL,
	`entry` integer,
	FOREIGN KEY (`account`) REFERENCES `platform_user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session`) REFERENCES `platform_session`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`entry`) REFERENCES `platform_action_log`(`entry`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "platform_confirmations_kind" CHECK("__new_platform_confirmations"."kind" IN ('read', 'write')),
	CONSTRAINT "platform_confirmations_state" CHECK("__new_platform_confirmations"."state" IN ('pending', 'consumed', 'rejected', 'ended'))
);
--> statement-breakpoint
INSERT INTO `__new_platform_confirmations`("id", "account", "via", "kind", "operation", "fingerprint", "key", "origin", "session", "bound", "created_at", "window_closes_at", "expires_at", "context_only", "state", "entry") SELECT "id", "account", "via", "kind", "operation", "fingerprint", "key", "origin", "session", "bound", "created_at", "window_closes_at", "expires_at", "context_only", "state", "entry" FROM `platform_confirmations`;--> statement-breakpoint
DROP TABLE `platform_confirmations`;--> statement-breakpoint
ALTER TABLE `__new_platform_confirmations` RENAME TO `platform_confirmations`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `platform_confirmations_account_key` ON `platform_confirmations` (`account`,`key`);--> statement-breakpoint
CREATE INDEX `platform_confirmations_session` ON `platform_confirmations` (`session`);
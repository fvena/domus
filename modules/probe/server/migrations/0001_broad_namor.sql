CREATE TABLE `probe_board` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`body` text NOT NULL,
	`owner` text NOT NULL,
	`visibility` text NOT NULL,
	CONSTRAINT "probe_board_visibility" CHECK("visibility" in ('private', 'public'))
);
--> statement-breakpoint
CREATE TABLE `probe_health` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`body` text NOT NULL,
	`owner` text NOT NULL,
	`visibility` text NOT NULL,
	CONSTRAINT "probe_health_visibility" CHECK("visibility" = 'private')
);
--> statement-breakpoint
CREATE TABLE `probe_secret` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`body` text NOT NULL,
	`owner` text NOT NULL,
	`visibility` text NOT NULL,
	CONSTRAINT "probe_secret_visibility" CHECK("visibility" = 'private')
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_probe_comments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`note_id` integer NOT NULL,
	`body` text NOT NULL,
	`owner` text NOT NULL,
	`visibility` text NOT NULL,
	FOREIGN KEY (`note_id`) REFERENCES `probe_notes`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "probe_comments_visibility" CHECK("visibility" in ('private', 'public'))
);
--> statement-breakpoint
INSERT INTO `__new_probe_comments`("id", "note_id", "body", "owner", "visibility") SELECT "id", "note_id", "body", '', 'private' FROM `probe_comments`;--> statement-breakpoint
DROP TABLE `probe_comments`;--> statement-breakpoint
ALTER TABLE `__new_probe_comments` RENAME TO `probe_comments`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_probe_notes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`body` text NOT NULL,
	`owner` text NOT NULL,
	`visibility` text NOT NULL,
	CONSTRAINT "probe_notes_visibility" CHECK("visibility" in ('private', 'public'))
);
--> statement-breakpoint
INSERT INTO `__new_probe_notes`("id", "body", "owner", "visibility") SELECT "id", "body", '', 'private' FROM `probe_notes`;--> statement-breakpoint
DROP TABLE `probe_notes`;--> statement-breakpoint
ALTER TABLE `__new_probe_notes` RENAME TO `probe_notes`;
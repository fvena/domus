CREATE TABLE `sample_tags` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`noteId` integer NOT NULL,
	`name` text NOT NULL,
	FOREIGN KEY (`noteId`) REFERENCES `sample_notes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `sample_notes` ADD `pinned` integer DEFAULT false NOT NULL;
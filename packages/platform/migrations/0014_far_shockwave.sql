CREATE TABLE `platform_deliveries` (
	`job` integer PRIMARY KEY NOT NULL,
	`notice` integer NOT NULL,
	`subscription` text NOT NULL,
	`deadline` integer NOT NULL,
	FOREIGN KEY (`job`) REFERENCES `platform_jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`notice`) REFERENCES `platform_jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `platform_deliveries_notice_subscription` ON `platform_deliveries` (`notice`,`subscription`);
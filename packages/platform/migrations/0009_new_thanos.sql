PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_platform_task_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`task` text NOT NULL,
	`planned_date` text,
	`planned_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	`result` text,
	`error` text,
	CONSTRAINT "platform_task_runs_result" CHECK("__new_platform_task_runs"."result" IN ('ok', 'failed', 'cancelled', 'skipped'))
);
--> statement-breakpoint
INSERT INTO `__new_platform_task_runs`("id", "task", "planned_date", "planned_at", "started_at", "finished_at", "result", "error") SELECT "id", "task", "planned_date", "planned_at", "started_at", "finished_at", "result", "error" FROM `platform_task_runs`;--> statement-breakpoint
DROP TABLE `platform_task_runs`;--> statement-breakpoint
ALTER TABLE `__new_platform_task_runs` RENAME TO `platform_task_runs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `platform_task_runs_planned` ON `platform_task_runs` (`task`,`planned_date`);
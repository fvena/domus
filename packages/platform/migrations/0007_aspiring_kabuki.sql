CREATE TABLE `platform_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`lane` text NOT NULL,
	`state` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`run_at` integer NOT NULL,
	`task_run` integer,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	`error` text,
	FOREIGN KEY (`task_run`) REFERENCES `platform_task_runs`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "platform_jobs_lane" CHECK("platform_jobs"."lane" IN ('short', 'maintenance')),
	CONSTRAINT "platform_jobs_state" CHECK("platform_jobs"."state" IN ('pending', 'running', 'done', 'failed', 'cancelled', 'stuck'))
);
--> statement-breakpoint
CREATE INDEX `platform_jobs_due` ON `platform_jobs` (`lane`,`state`,`run_at`);--> statement-breakpoint
CREATE INDEX `platform_jobs_task_run` ON `platform_jobs` (`task_run`);--> statement-breakpoint
CREATE TABLE `platform_task_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`task` text NOT NULL,
	`planned_date` text,
	`planned_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	`result` text,
	`error` text,
	CONSTRAINT "platform_task_runs_result" CHECK("platform_task_runs"."result" IN ('ok', 'failed', 'cancelled', 'stuck', 'skipped'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `platform_task_runs_planned` ON `platform_task_runs` (`task`,`planned_date`);--> statement-breakpoint
CREATE TABLE `platform_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`time` text,
	`paused` integer DEFAULT false NOT NULL,
	`next_at` integer NOT NULL
);

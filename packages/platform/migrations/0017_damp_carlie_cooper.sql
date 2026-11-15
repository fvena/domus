DROP TABLE `platform_keys`;--> statement-breakpoint
DROP TABLE `platform_mandates`;--> statement-breakpoint
-- Written by hand (ADR 0034): the pending confirmations only for contexto, which nothing answers, go before their mark.
DELETE FROM `platform_confirmations` WHERE `context_only` = 1;--> statement-breakpoint
ALTER TABLE `platform_confirmations` DROP COLUMN `window_closes_at`;--> statement-breakpoint
ALTER TABLE `platform_confirmations` DROP COLUMN `context_only`;
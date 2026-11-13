// Platform: the door (http), the database, identity, authorization, audit, jobs and scheduled tasks,
// events, notifications and storage. createPlatform opens the SQLite file and applies the migrations of
// the platform and the modules (ADR 0021); the door takes the platform and the modules; runAccounts is the core
// of `pnpm accounts` (ADR 0023), and runRestoreCommand of `restore.mjs` (ADR 0026). Its contracts are a separate
// entry: @domus/platform/contracts.
export { createHttpHandler, type HttpHandler, type HttpHandlerOptions } from "./http";
export {
	ACCOUNTS_USAGE,
	type AccountsCommand,
	type AccountsTerminal,
	parseAccountsArguments,
	runAccounts,
} from "./identity/command";
export type { BackupConfig } from "./backups";
export {
	parseRestoreArguments,
	RESTORE_USAGE,
	type RestoreCommand,
	type RestoreTarget,
	type RestoreTerminal,
	runRestoreCommand,
} from "./backups/command";
export { createPlatform, type Platform, type PlatformOptions } from "./platform";

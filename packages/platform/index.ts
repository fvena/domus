// Platform: the door (http), the database, identity, authorization, audit, jobs and scheduled tasks,
// events, notifications and storage. createPlatform opens the SQLite file and applies the migrations of
// the platform and the modules (ADR 0021); the door takes the platform from phase 1a. Its contracts are
// a separate entry: @domus/platform/contracts.
export { createHttpHandler, type HttpHandler } from "./http";
export { type ModuleDatabase, moduleDatabase } from "./module-database";
export { createPlatform, type Platform, type PlatformOptions } from "./platform";

// The only part of platform a module may use (ADR 0021). Phase 1a brings defineModule and, in
// @domus/module-sdk/db, prefixed tables over Drizzle; each later subphase adds its piece.
export {
	checkModules,
	defineModule,
	type ModuleDefinition,
	type ModuleMigration,
	type ModuleSchema,
	PLATFORM_ID,
} from "./module";

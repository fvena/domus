// The only part of platform a module may use (ADR 0021, ADR 0022). defineModule takes the tables, migrations,
// contract and actions of a module; @domus/module-sdk/db offers prefixed tables over Drizzle and
// @domus/module-sdk/contracts the pure helpers of a contract. A handler's context is the only way a module gets
// its database: nothing here hands one out. Each later subphase adds its piece.
export type {
	ActionContext,
	ActionErrors,
	ActionHandler,
	ActionInput,
	ActionMetaOf,
	ActionOutput,
	Actor,
	Inverse,
	ModuleActions,
	ModuleDatabase,
	ModuleSchema,
	TouchedRecord,
	WriteOutcome,
} from "./actions";
export {
	type AreaDefinition,
	areaIds,
	checkModules,
	defineModule,
	type ModuleDefinition,
	type ModuleMigration,
	PLATFORM_ID,
} from "./module";

// The platform's migrations, which run before every module's (ADR 0021): the two hand-written ones, then the
// ones `pnpm db:generate` writes from `schema.ts`, from position 2 on (ADR 0023).
import type { ModuleMigration } from "@domus/module-sdk";

import { generatedMigrations } from "./generated-migrations";
import { handWrittenMigrations } from "./hand-written-migrations";

export const migrations: readonly ModuleMigration[] = [
	...handWrittenMigrations,
	...generatedMigrations,
];

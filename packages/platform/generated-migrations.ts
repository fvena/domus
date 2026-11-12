// Written by `pnpm db:generate` from `migrations/`, leaving out its base (ADR 0023). Do not edit: change
// `schema.ts` and generate.
import type { ModuleMigration } from "@domus/module-sdk";

export const generatedMigrations: readonly ModuleMigration[] = [
	{
		tag: "0001_lively_sharon_carter",
		position: 2,
		hash: "45fc89e93dbe3ce3adab1187fe68762b22c1e2ff74af1d5f9684cce8437d9606",
		statements: ["ALTER TABLE `platform_action_log` DROP COLUMN `result`;"],
	},
];

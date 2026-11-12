// `pnpm db:generate` (ADR 0021, ADR 0023): first the platform's migrations, from `packages/platform/schema.ts`;
// then, for every module with a `server/schema.ts`, drizzle-kit writes its new migration into
// `server/migrations/`, and then `server/migrations.ts` is written from that folder. drizzle-kit may ask about
// a rename: run it locally, answer, and review what it wrote. CI runs it with stdin closed, so a question there
// fails the job.
import { join } from "node:path";

import { handWrittenMigrations } from "../../packages/platform/hand-written-migrations";
import { drizzleKitGenerate } from "./drizzle-kit";
import { errorMessage, moduleFolders, writeIfChanged } from "./generated";
import { migrationsSource } from "./module-migrations";
import { platformMigrationsSource } from "./platform-migrations";

const root = join(import.meta.dirname, "../..");
const platform = "packages/platform";

/** The platform's: drizzle-kit writes into `migrations/`, then `generated-migrations.ts` is written from it. */
function generatePlatform(): void {
	try {
		drizzleKitGenerate(`${platform}/schema.ts`, `${platform}/migrations`);
		const source = platformMigrationsSource(
			join(root, platform, "migrations"),
			handWrittenMigrations,
		);
		if (writeIfChanged(join(root, platform, "generated-migrations.ts"), source))
			console.log(`db:generate: wrote ${platform}/generated-migrations.ts`);
	} catch (error) {
		throw new Error(`db:generate: platform: ${errorMessage(error)}`);
	}
}

function generate(): void {
	generatePlatform();

	const modules = moduleFolders(root, "server/schema.ts");
	if (modules.length === 0) console.log("db:generate: no module has a server/schema.ts");

	for (const id of modules) {
		const server = `modules/${id}/server`;
		try {
			drizzleKitGenerate(`${server}/schema.ts`, `${server}/migrations`);
			const source = migrationsSource(join(root, server, "migrations"));
			if (writeIfChanged(join(root, server, "migrations.ts"), source))
				console.log(`db:generate: wrote ${server}/migrations.ts`);
		} catch (error) {
			throw new Error(`db:generate: module "${id}": ${errorMessage(error)}`);
		}
	}
}

try {
	generate();
} catch (error) {
	console.error(errorMessage(error));
	process.exitCode = 1;
}

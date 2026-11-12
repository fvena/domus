import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ModuleDefinition, ModuleSchema } from "@domus/module-sdk";
import {
	createHttpHandler,
	createPlatform,
	type HttpHandler,
	type ModuleDatabase,
	moduleDatabase,
	type Platform,
	type PlatformOptions,
} from "@domus/platform";

export interface TestPlatformOptions {
	/** The modules under test: tests import them and pass them here; test-utils imports none. */
	readonly modules: PlatformOptions["modules"];
	/**
	 * Where the database lives. Unset: in memory. `true`: a file in a temporary folder, removed on
	 * close. A path: that file, kept on close, for tests that open the same data again.
	 */
	readonly file?: true | string;
}

export interface TestPlatform extends AsyncDisposable {
	readonly platform: Platform;
	/** The door, in process, on this platform. */
	readonly door: HttpHandler;
	/** `":memory:"` or the path of the file in use. */
	readonly databaseFile: string;
	/**
	 * The Drizzle client of one of `modules`, typed with its schema, for storage tests to prepare and read
	 * data directly. Only tests have it: every action will run through authorization.
	 */
	dbFor<TSchema extends ModuleSchema>(module: ModuleDefinition<TSchema>): ModuleDatabase<TSchema>;
	/** Closes the platform and removes the temporary folder it created. Safe to call more than once. */
	close(): void;
}

/**
 * A real platform for tests, with the migrations of the platform and of `modules` applied: in memory by
 * default, or on a file. Use it with `await using`.
 */
export function createTestPlatform({ modules, file }: TestPlatformOptions): TestPlatform {
	let tempDir: string | undefined;
	let databaseFile = file ?? ":memory:";
	if (databaseFile === true) {
		tempDir = mkdtempSync(join(tmpdir(), "domus-test-"));
		databaseFile = join(tempDir, "domus.db");
	}

	let platform: Platform;
	try {
		platform = createPlatform({ databaseFile, modules });
	} catch (error) {
		if (tempDir) rmSync(tempDir, { recursive: true, force: true });
		throw error;
	}

	const close = () => {
		platform.close();
		if (tempDir) rmSync(tempDir, { recursive: true, force: true });
	};

	return {
		platform,
		door: createHttpHandler({ platform, modules }),
		databaseFile,
		dbFor: (module) => moduleDatabase(platform, module),
		close,
		[Symbol.asyncDispose]: () => Promise.resolve(close()),
	};
}

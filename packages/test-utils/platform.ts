import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	createHttpHandler,
	createPlatform,
	type HttpHandler,
	type Platform,
} from "@domus/platform";

export interface TestPlatformOptions {
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
	/** Closes the platform and removes the temporary folder it created. Safe to call more than once. */
	close(): void;
}

/** A real platform for tests: in memory by default, or on a file. Use it with `await using`. */
export function createTestPlatform({ file }: TestPlatformOptions = {}): TestPlatform {
	let tempDir: string | undefined;
	let databaseFile = file ?? ":memory:";
	if (databaseFile === true) {
		tempDir = mkdtempSync(join(tmpdir(), "domus-test-"));
		databaseFile = join(tempDir, "domus.db");
	}

	let platform: Platform;
	try {
		platform = createPlatform({ databaseFile });
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
		door: createHttpHandler(),
		databaseFile,
		close,
		[Symbol.asyncDispose]: () => Promise.resolve(close()),
	};
}

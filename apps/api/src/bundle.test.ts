// The bundles the image runs start: built by the real `build` script, each loads every module it imports and
// stops on its first missing setting. A dependency that cannot load bundled as ESM (a CommonJS one requiring a
// Node builtin, as web-push does) stops it earlier, with another error, which only the containers job of CI
// would see otherwise. The bundles stay in dist/, where Node resolves the external better-sqlite3.
import { execFileSync, spawnSync } from "node:child_process";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

const api = join(import.meta.dirname, "..");

beforeAll(() => {
	execFileSync("pnpm", ["run", "--silent", "build"], { cwd: api, stdio: "ignore" });
}, 60_000);

describe("the api's bundles", () => {
	it.each([
		["main.mjs", [], "DOMUS_DATA_DIR is required"],
		["restore.mjs", ["list"], "DOMUS_DATA_DIR is required"],
		["accounts.mjs", [], "accounts needs a subcommand"],
	])("%s starts and stops on its configuration", (bundle, args, expected) => {
		const run = spawnSync(process.execPath, [join(api, "dist", bundle), ...args], {
			env: { PATH: process.env["PATH"] ?? "" },
			encoding: "utf8",
			timeout: 20_000,
		});
		expect(run.status).not.toBe(0);
		expect(run.stderr).toContain(expected);
	});
});

// Proves the rules in .dependency-cruiser.cjs fire: a fixture repository with allowed imports and at
// least one forbidden import per rule, cruised with the real rules and options. A rule that stops
// firing, or a new rule without a case here, fails this test.
import { createRequire } from "node:module";
import { join } from "node:path";

import { cruise, type ICruiseResult } from "dependency-cruiser";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const config = require("../../.dependency-cruiser.cjs");
const fixture = join(import.meta.dirname, "fixtures/architecture");

async function violations(): Promise<string[]> {
	const { options } = config;
	const result = await cruise(["apps", "packages", "modules"], {
		baseDir: fixture,
		ruleSet: { forbidden: config.forbidden },
		validate: true,
		doNotFollow: options.doNotFollow,
		exclude: options.exclude,
		tsPreCompilationDeps: true,
		enhancedResolveOptions: options.enhancedResolveOptions,
	});
	const output = result.output as ICruiseResult;
	return output.summary.violations.map((v) => `${v.rule.name}: ${v.from} -> ${v.to}`).sort();
}

const ruleNames: string[] = config.forbidden.map((rule: { name: string }) => rule.name);

describe("dependency rules", () => {
	it("each fire at least once on the fixture", async () => {
		const fired = new Set((await violations()).map((line) => line.split(":")[0]));
		expect(ruleNames.filter((name) => !fired.has(name))).toEqual([]);
	});

	it("flag exactly the forbidden imports of the fixture", async () => {
		expect(await violations()).toEqual([
			"api-reaches-modules-through-server-entry: apps/api/src/bad.ts -> modules/lists/server/internal.ts",
			"apps-hold-no-business-logic: apps/api/src/db.ts -> node_modules/better-sqlite3/index.js",
			"apps-hold-no-business-logic: apps/api/src/drizzle.ts -> node_modules/drizzle-orm/index.js",
			"assistant-and-voice-gateway-only-talk-to-api: apps/assistant/src/bad.ts -> modules/lists/contracts/index.ts",
			"assistant-and-voice-gateway-only-talk-to-api: apps/assistant/src/bad.ts -> packages/platform/src/index.ts",
			"business-free-packages-stay-business-free: packages/api-client/index.ts -> packages/platform/contracts/index.ts",
			"business-free-packages-stay-business-free: packages/i18n/index.ts -> packages/platform/http/index.ts",
			"business-free-packages-stay-business-free: packages/ui/src/bad.ts -> packages/platform/src/index.ts",
			"contracts-are-pure: modules/lists/contracts/node.ts -> path",
			"contracts-are-pure: packages/platform/contracts/bad.ts -> fs",
			"module-contracts-stand-alone: modules/lists/contracts/bad.ts -> modules/lists/server/index.ts",
			"module-imports-only-contracts-of-others: modules/lists/server/bad.ts -> modules/calendar/server/index.ts",
			"module-no-data-or-ai-libs: modules/lists/server/db.ts -> node_modules/better-sqlite3/index.js",
			"module-server-and-web-stay-apart: modules/lists/server/bad.ts -> modules/lists/web/index.ts",
			"module-tests-use-only-test-utils: modules/lists/tests/bad.test.ts -> packages/platform/src/index.ts",
			"module-uses-only-module-sdk: modules/lists/server/bad.ts -> packages/platform/src/index.ts",
			"module-web-uses-only-ui-and-api-client: modules/lists/web/sdk.ts -> packages/module-sdk/src/index.ts",
			"no-cycles: packages/i18n/cycle-a.ts -> packages/i18n/cycle-b.ts",
			"no-unresolvable: apps/web/src/undeclared.ts -> @domus/not-declared",
			"nothing-imports-an-app: apps/assistant/src/bad.ts -> apps/api/src/main.ts",
			"nothing-imports-an-app: packages/platform/src/bad.ts -> apps/api/src/main.ts",
			"only-package-exports: apps/api/src/bad.ts -> modules/lists/server/internal.ts",
			"only-package-exports: apps/api/src/bad.ts -> packages/platform/src/internal.ts",
			"only-tests-import-test-utils: apps/api/src/uses-test-utils.ts -> packages/test-utils/src/index.ts",
			"packages-never-import-modules: packages/platform/src/bad.ts -> modules/lists/server/index.ts",
			"platform-contracts-stand-alone: packages/platform/contracts/bad.ts -> packages/platform/http/index.ts",
			"programs-never-reach-platform: apps/assistant/src/bad.ts -> packages/module-sdk/src/index.ts",
			"programs-never-reach-platform: apps/assistant/src/bad.ts -> packages/platform/src/index.ts",
			"programs-never-reach-platform: apps/voice-gateway/src/indirect.ts -> packages/platform/http/index.ts",
			"programs-never-reach-platform: apps/web/src/bad.ts -> packages/module-sdk/src/index.ts",
			"programs-never-reach-platform: apps/web/src/bad.ts -> packages/platform/src/index.ts",
			"utils-imports-no-other-package: packages/utils/a/package-import.ts -> packages/i18n/index.ts",
			"utils-topics-stand-alone: packages/utils/a/bad.ts -> packages/utils/b/index.ts",
			"web-never-imports-the-server-side: apps/web/src/bad.ts -> packages/module-sdk/src/index.ts",
			"web-reaches-modules-through-web-entry: apps/web/src/module-contracts.ts -> modules/lists/contracts/index.ts",
		]);
	});
});

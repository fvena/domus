/**
 * Architecture rules, enforced by `pnpm lint` (docs/architecture/adr/0017-estructura-del-repositorio.md).
 * tooling/scripts/architecture.test.ts proves each rule fires on a small fixture.
 * A violation means the layering is broken: fix the import, never relax a rule.
 */

/** Libraries that hold data or run AI. Apps reach them only through platform; modules only through module-sdk. */
const DATA_AND_AI_LIBS =
	"node_modules/(better-sqlite3|drizzle-orm|kysely|ai|@ai-sdk|@anthropic-ai)/";

/** The one part of platform that the browser, assistant and voice-gateway may import. */
const PLATFORM_CONTRACTS = "packages/platform/contracts/";

/** The pure entry of module-sdk that a module's contracts use (ADR 0022); the browser reaches it through them. */
const SDK_CONTRACTS = "packages/module-sdk/contracts/";

/** Packages that know nothing of the business, open to modules and to the HTTP-only apps. */
const DOMAIN_FREE = "packages/(utils|i18n)/";

module.exports = {
	forbidden: [
		{
			name: "no-unresolvable",
			comment:
				"An import that does not resolve slips past every other rule: declare the package in package.json.",
			severity: "error",
			from: {},
			to: { couldNotResolve: true },
		},
		{
			name: "no-cycles",
			severity: "error",
			from: {},
			to: { circular: true },
		},

		// --- apps are programs ---
		{
			name: "nothing-imports-an-app",
			comment: "Apps are programs at the top: no package, module or other app imports one.",
			severity: "error",
			from: { path: "^(apps|packages|modules)/([^/]+)/" },
			to: { path: "^apps/", pathNot: "^$1/$2/" },
		},
		{
			name: "apps-hold-no-business-logic",
			comment:
				"Apps hold no business logic: data and AI libraries are reached through platform and the modules, never from an app.",
			severity: "error",
			from: { path: "^apps/" },
			to: { path: DATA_AND_AI_LIBS },
		},
		{
			name: "api-reaches-modules-through-server-entry",
			comment:
				"apps/api starts each module through its server entry (the module list written by pnpm modules:generate and kept in git, ADR 0021), never its internals.",
			severity: "error",
			from: { path: "^apps/api/" },
			to: { path: "^modules/", pathNot: "^modules/[^/]+/server/index\\.ts$" },
		},
		{
			name: "web-reaches-modules-through-web-entry",
			comment:
				"apps/web shows each module's screens through its web entry, never its server or internals.",
			severity: "error",
			from: { path: "^apps/web/" },
			to: { path: "^modules/", pathNot: "^modules/[^/]+/web/index\\.ts$" },
		},
		{
			name: "web-never-imports-the-server-side",
			comment:
				"apps/web runs in the browser and talks to the api through @domus/api-client; of platform it sees only the contracts.",
			severity: "error",
			from: { path: "^apps/web/" },
			to: { path: "^packages/(platform|module-sdk)/", pathNot: `^${PLATFORM_CONTRACTS}` },
		},
		{
			name: "assistant-and-voice-gateway-only-talk-to-api",
			comment:
				"assistant and voice-gateway reach Domus only over HTTP through the api: of platform only the contracts; no module-sdk, no modules, no UI.",
			severity: "error",
			from: { path: "^apps/(assistant|voice-gateway)/" },
			to: {
				path: ["^packages/(platform|module-sdk|ui)/", "^modules/"],
				pathNot: `^${PLATFORM_CONTRACTS}`,
			},
		},
		{
			name: "programs-never-reach-platform",
			comment:
				"The same rule through any chain of imports: production code of web, assistant and voice-gateway reaches no part of platform but its contracts, and the contracts entry of module-sdk through a module's contracts. Tests may, through test-utils.",
			severity: "error",
			from: { path: "^apps/(web|assistant|voice-gateway)/", pathNot: "\\.test\\.ts$" },
			to: {
				path: "^packages/(platform|module-sdk)/",
				pathNot: [`^${PLATFORM_CONTRACTS}`, `^${SDK_CONTRACTS}`],
				reachable: true,
			},
		},

		// --- modules ---
		{
			name: "module-uses-only-module-sdk",
			comment:
				"A module reaches platform only through module-sdk; besides it, only the business-free packages.",
			severity: "error",
			from: { path: "^modules/[^/]+/(contracts|server|assistant)/" },
			to: { path: "^packages/", pathNot: ["^packages/module-sdk/", `^${DOMAIN_FREE}`] },
		},
		{
			name: "module-web-uses-only-ui-and-api-client",
			comment:
				"A module's screens use the design system, the API client and the business-free packages; module-sdk is server-side.",
			severity: "error",
			from: { path: "^modules/[^/]+/web/" },
			to: {
				path: "^packages/",
				pathNot: ["^packages/(ui|api-client)/", `^${DOMAIN_FREE}`],
			},
		},
		{
			name: "module-tests-use-only-test-utils",
			comment: "A module's tests may add test-utils to what the module itself may import.",
			severity: "error",
			from: { path: "^modules/[^/]+/tests/" },
			to: {
				path: "^packages/",
				pathNot: ["^packages/(module-sdk|ui|api-client|test-utils)/", `^${DOMAIN_FREE}`],
			},
		},
		{
			name: "module-imports-only-contracts-of-others",
			comment: "A module reaches another module only through that module's contracts.",
			severity: "error",
			from: { path: "^modules/([^/]+)/" },
			to: { path: "^modules/", pathNot: ["^modules/$1/", "^modules/[^/]+/contracts/"] },
		},
		{
			name: "module-contracts-stand-alone",
			comment:
				"A module's contracts are its public face: they never import its server, web or assistant parts.",
			severity: "error",
			from: { path: "^modules/([^/]+)/contracts/" },
			to: { path: "^modules/$1/", pathNot: "^modules/$1/contracts/" },
		},
		{
			name: "module-server-and-web-stay-apart",
			comment: "A module's server and web parts share only its contracts.",
			severity: "error",
			from: { path: "^modules/([^/]+)/(server|web)/" },
			to: { path: "^modules/$1/(server|web)/", pathNot: "^modules/$1/$2/" },
		},
		{
			name: "module-no-data-or-ai-libs",
			comment: "A module reaches its tables and the model only through module-sdk.",
			severity: "error",
			from: { path: "^modules/" },
			to: { path: DATA_AND_AI_LIBS },
		},

		{
			name: "contracts-are-pure",
			comment:
				"Contracts are imported by the browser, assistant and voice-gateway: no Node built-ins in them.",
			severity: "error",
			from: {
				path: ["^modules/[^/]+/contracts/", `^${PLATFORM_CONTRACTS}`, `^${SDK_CONTRACTS}`],
			},
			to: { dependencyTypes: ["core"] },
		},
		{
			name: "module-contracts-reach-only-sdk-contracts",
			comment:
				"A module's contracts reach, through any chain of imports, no Drizzle or data library and of module-sdk only its contracts entry (ADR 0022).",
			severity: "error",
			from: { path: "^modules/[^/]+/contracts/" },
			to: {
				path: ["^packages/module-sdk/", DATA_AND_AI_LIBS],
				pathNot: `^${SDK_CONTRACTS}`,
				reachable: true,
			},
		},
		{
			name: "sdk-contracts-stand-alone",
			comment:
				"The contracts entry of module-sdk imports no other part of the SDK, no other package and no data library (ADR 0022).",
			severity: "error",
			from: { path: `^${SDK_CONTRACTS}` },
			to: { path: ["^packages/", DATA_AND_AI_LIBS], pathNot: `^${SDK_CONTRACTS}` },
		},

		// --- packages ---
		{
			name: "platform-contracts-stand-alone",
			comment: "platform/contracts imports no other part of platform and no other package.",
			severity: "error",
			from: { path: `^${PLATFORM_CONTRACTS}` },
			to: { path: "^packages/", pathNot: `^${PLATFORM_CONTRACTS}` },
		},
		{
			name: "packages-never-import-modules",
			comment: "Packages know no module; modules plug into them.",
			severity: "error",
			from: { path: "^packages/" },
			to: { path: "^modules/" },
		},
		{
			name: "business-free-packages-stay-business-free",
			comment:
				"utils, i18n, ui and api-client know nothing of platform, its contracts included, or of tests: api-client receives contracts from its callers.",
			severity: "error",
			from: { path: "^packages/(utils|i18n|ui|api-client)/" },
			to: { path: "^packages/(platform|module-sdk|test-utils)/" },
		},
		{
			name: "utils-imports-no-other-package",
			severity: "error",
			from: { path: "^packages/utils/" },
			to: { path: "^packages/", pathNot: "^packages/utils/" },
		},
		{
			name: "utils-topics-stand-alone",
			comment:
				"A utils topic does not import another without a reason; add a named exception here, with the reason, when one does.",
			severity: "error",
			from: { path: "^packages/utils/([^/]+)/" },
			to: { path: "^packages/utils/", pathNot: "^packages/utils/$1/" },
		},
		{
			name: "background-stays-in-platform",
			comment:
				"The background engine, the scheduler and the maintenance belong to platform (ADR 0025): module-sdk does not expose them and no module reaches them, through any chain of imports. Tests may, through test-utils.",
			severity: "error",
			from: {
				path: "^(modules|packages/module-sdk)/",
				pathNot: ["\\.test\\.ts$", "^modules/[^/]+/tests/"],
			},
			to: { path: "^packages/platform/background/", reachable: true },
		},
		{
			name: "only-test-utils-reaches-platform-testing",
			comment:
				"@domus/platform/testing hands out a module's raw Drizzle client, outside authorization: only test-utils takes it, for dbFor (ADR 0021).",
			severity: "error",
			from: {
				path: "^(apps|packages|modules)/",
				pathNot: "^packages/(test-utils|platform)/",
			},
			to: { path: "^packages/platform/testing/" },
		},
		{
			name: "production-never-reaches-platform-testing",
			comment:
				"@domus/platform/testing also holds the privileged preparation (accounts, roles, permission rows without a session or a proof) and synthetic verified contexts (ADR 0023): no production code reaches it through any chain of imports, platform's own included.",
			severity: "error",
			from: {
				path: "^(apps|packages|modules)/",
				pathNot: [
					"\\.test\\.ts$",
					"^modules/[^/]+/tests/",
					"^packages/(test-utils|platform/testing)/",
				],
			},
			to: { path: "^packages/platform/testing/", reachable: true },
		},
		{
			name: "only-tests-import-test-utils",
			severity: "error",
			from: {
				path: "^(apps|packages|modules)/",
				pathNot: ["\\.test\\.ts$", "^modules/[^/]+/tests/", "^packages/test-utils/"],
			},
			to: { path: "^packages/test-utils/" },
		},
		{
			name: "only-package-exports",
			comment:
				"Import another package or module by its name, never by a path into its files.",
			severity: "error",
			from: { path: "^(apps|packages|modules)/([^/]+)/" },
			to: { path: "^(packages|modules)/", pathNot: ["^$1/$2/", "/index\\.ts$"] },
		},
	],
	options: {
		doNotFollow: { path: "node_modules" },
		exclude: { path: "^(apps|packages|modules|tooling)/[^/]+/(dist|generated)/" },
		tsPreCompilationDeps: true,
		tsConfig: { fileName: "tsconfig.json" },
		enhancedResolveOptions: {
			exportsFields: ["exports"],
			conditionNames: ["import", "types", "default"],
			extensions: [".ts", ".js", ".vue"],
		},
	},
};

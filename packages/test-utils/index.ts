// What tests use to stand in for real infrastructure. Only tests import it.
export { createTestBrowser, type TestBrowser } from "./browser";
export {
	type ContextOptions,
	createTestPlatform,
	type PreparedAccount,
	TEST_ORIGIN,
	TEST_START,
	type TestPlatform,
	type TestPlatformOptions,
	type TestPreparation,
} from "./platform";
export type { VerifiedContext } from "@domus/platform/testing";
/** The platform's own operations, for HTTP tests of modules, whose rules keep them from platform's contracts. */
export { platformContract } from "@domus/platform/contracts";

// What tests use to stand in for real infrastructure. Only tests import it.
export {
	type ActionName,
	createTestPlatform,
	type InvokeResult,
	TEST_START,
	type TestClock,
	type TestPlatform,
	type TestPlatformOptions,
	type WriteOptions,
} from "./platform";

// What tests use to stand in for real infrastructure. Only tests import it.
export {
	type ActionName,
	createTestPlatform,
	TEST_START,
	type TestClock,
	type TestPlatform,
	type TestPlatformOptions,
} from "./platform";

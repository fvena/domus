// What tests use to stand in for real infrastructure. Only tests import it.
export { createTestBrowser, type TestBrowser } from "./browser";
export {
	type ClockMove,
	type ContextOptions,
	createTestPlatform,
	type DelegationChange,
	listBackups,
	restoreBackup,
	type TestBackups,
	type TestRestoreOptions,
	pendingFrom,
	type PermissionChange,
	type PreparedAccount,
	type SyntheticJob,
	TEST_ORIGIN,
	TEST_PUSH_SUBJECT,
	TEST_START,
	type TestPlatform,
	type TestPlatformOptions,
	type TestPreparation,
	type WriteOptions,
} from "./platform";
export {
	FAKE_PUSH_HOST,
	type FakePushService,
	fakePushService,
	neverAnswers,
	type PushAnswer,
	pushClient,
	type PushClient,
	type PushRequest,
	vapidClaims,
	type VapidClaims,
} from "./push";
export { requireRestic } from "./restic";
export {
	type ChannelItem,
	type EventReader,
	type OpenChannel,
	openChannel,
	readEvents,
} from "./sse";
export {
	type ChildTask,
	contentPath,
	fakeNode,
	type InterleavePoint,
	PermanentJobError,
	type RestorePoint,
	startChild,
	type TestChild,
	type VerifiedContext,
} from "@domus/platform/testing";
/** The platform's own operations, for HTTP tests of modules, whose rules keep them from platform's contracts. */
export { platformContract } from "@domus/platform/contracts";

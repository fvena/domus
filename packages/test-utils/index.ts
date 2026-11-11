// What tests use to stand in for real infrastructure. Only tests import it.
import { createHttpHandler, type HttpHandler } from "@domus/platform";

export { createTestPlatform, type TestPlatform, type TestPlatformOptions } from "./platform";

/**
 * The real door, in process: programs that talk to the api over HTTP (assistant, voice-gateway) pass
 * its `fetch` instead of the network's. It takes the in-memory platform once the door receives one.
 */
export function createTestHttpHandler(): HttpHandler {
	return createHttpHandler();
}

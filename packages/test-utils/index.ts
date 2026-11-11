// What tests use to stand in for real infrastructure. Only tests import it.
import { createHttpHandler, type HttpHandler } from "@domus/platform";

/**
 * The real door, in process: programs that talk to the api over HTTP (assistant, voice-gateway) pass
 * its `fetch` instead of the network's. From phase 1 it runs on an in-memory platform.
 */
export function createTestHttpHandler(): HttpHandler {
	return createHttpHandler();
}

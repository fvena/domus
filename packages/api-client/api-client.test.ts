import { oc } from "@orpc/contract";
import { describe, expect, it } from "vitest";

import { clientFor } from ".";

describe("clientFor", () => {
	it("asks for the api's address outside the browser", () => {
		expect(() => clientFor({ ping: oc })).toThrow(/baseUrl/);
	});
});

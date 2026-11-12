import { oc } from "@orpc/contract";
import { describe, expect, it } from "vitest";

import { clientFor } from ".";

/** A fetch that records each request and answers `null` as oRPC's RPC protocol does. */
function recording() {
	const requests: Request[] = [];
	const fetch = async (request: Request) => {
		requests.push(request);
		return Response.json({ json: null });
	};
	return { requests, fetch };
}

describe("clientFor", () => {
	it("asks for the api's address outside the browser", () => {
		expect(() => clientFor({ ping: oc })).toThrow(/baseUrl/);
	});

	it("sends a call's idempotency key as a header, beside the transport's own headers", async () => {
		const { requests, fetch } = recording();
		const client = clientFor(
			{ notes: { add: oc } },
			{ baseUrl: "http://domus", fetch, headers: () => ({ cookie: "a=1" }) },
		);

		await client.notes.add(undefined, { context: { idempotencyKey: "k1" } });
		await client.notes.add(undefined);

		expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
			"/api/rpc/notes/add",
			"/api/rpc/notes/add",
		]);
		expect(requests.map((request) => request.headers.get("idempotency-key"))).toEqual([
			"k1",
			null,
		]);
		expect(requests.map((request) => request.headers.get("cookie"))).toEqual(["a=1", "a=1"]);
	});

	it("sends a call's step-up proof as a header of its own", async () => {
		const { requests, fetch } = recording();
		const client = clientFor({ settings: { change: oc } }, { baseUrl: "http://domus", fetch });

		await client.settings.change(undefined, {
			context: { idempotencyKey: "k1", proof: "p1" },
		});
		await client.settings.change(undefined, { context: { idempotencyKey: "k2" } });

		expect(requests.map((request) => request.headers.get("step-up-proof"))).toEqual([
			"p1",
			null,
		]);
	});
});

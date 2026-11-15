import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { readMandate } from "./mandates";

describe("readMandate", () => {
	it("reads nothing from no header", () => {
		expect(readMandate(null)).toEqual({ kind: "none" });
	});

	it("reads the id of a mandate: 32 bytes in base64url, without padding", () => {
		const id = randomBytes(32).toString("base64url");
		expect(readMandate(id)).toEqual({ kind: "mandate", id });
		expect(readMandate(`  ${id} `)).toEqual({ kind: "mandate", id });
	});

	it("takes any other form as a bad mandate, never as none", () => {
		const id = randomBytes(32).toString("base64url");
		for (const value of [
			"",
			" ",
			`${id}x`,
			id.slice(1),
			`${id}=`,
			randomBytes(32).toString("base64"),
			randomBytes(31).toString("base64url"),
			randomBytes(33).toString("base64url"),
			`${id} ${id}`,
			`${id},${id}`,
			// The last of 43 characters carries 2 bits of padding, which must be zero: "B" never ends an exact one.
			`${id.slice(0, 42)}B`,
		])
			expect({ value, read: readMandate(value) }).toEqual({ value, read: { kind: "bad" } });
	});
});

// Which operations of the platform admit a mandate (ADR 0030): only a closed list, so every other one, also one
// added tomorrow, refuses it.
import { describe, expect, it } from "vitest";

import { admitsMandate } from ".";
import { platformContract } from "../contracts";

/** Every procedure of `router` by its path, `<group>/<name>`, as the door serves it. */
function pathsOf(router: object, prefix = ""): string[] {
	return Object.entries(router).flatMap(([name, value]: [string, object]) =>
		"~orpc" in value ? [`${prefix}${name}`] : pathsOf(value, `${prefix}${name}/`),
	);
}

describe("the operations of the platform a mandate reaches", () => {
	it("are reading the log and undoing in it", () => {
		expect(admitsMandate("log/read")).toBe(true);
		expect(admitsMandate("log/undo")).toBe(true);
	});

	it("are no other operation of the platform", () => {
		const others = pathsOf(platformContract).filter(
			(path) => path !== "log/read" && path !== "log/undo",
		);

		expect(others).toContain("confirmations/confirm");
		expect(others).toContain("delegation/read");
		expect(others.filter((path) => admitsMandate(path))).toEqual([]);
	});

	it("are no operation it does not know, nor another way of writing one it does", () => {
		for (const name of ["", "log", "log/", "log/delete", "Log/read", "log.read", "/log/read"])
			expect({ name, admits: admitsMandate(name) }).toEqual({ name, admits: false });
	});
});

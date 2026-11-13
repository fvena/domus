import { describe, expect, it } from "vitest";

import { parseRestoreArguments } from "./command";

describe("parseRestoreArguments", () => {
	it("reads listing, restoring the latest and restoring one snapshot", () => {
		expect(parseRestoreArguments(["list"])).toEqual({ kind: "list" });
		expect(parseRestoreArguments([])).toEqual({ kind: "restore" });
		expect(parseRestoreArguments(["--snapshot", "4f2a9c1e"])).toEqual({
			kind: "restore",
			snapshot: "4f2a9c1e",
		});
	});

	it.each([
		[["list", "extra"], "list takes no arguments"],
		[["--snapshot"], "--snapshot needs a snapshot id"],
		[["--snapshot", ""], "--snapshot needs a snapshot id"],
		[["--snapshot", "a b"], "--snapshot needs a snapshot id"],
		[["--snapshot", "4f2a9c1e", "--snapshot", "77aa"], "unexpected argument: --snapshot"],
		[["--cut", "marker-written"], "unexpected argument: --cut"],
		[["restore"], "unexpected argument: restore"],
	])("refuses %j", (argv, error) => {
		expect(parseRestoreArguments(argv)).toEqual({ error });
	});
});

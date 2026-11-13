import { fileRef } from "@domus/module-sdk/contracts";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { markedFiles } from "./marked";

const file = (id: string) => ({ id, name: `${id}.jpg`, type: "image/jpeg", size: 1 });

describe("the files a read's output holds at positions marked with fileRef()", () => {
	it("finds them inside objects, arrays, optional, nullable, defaulted and read-only values", () => {
		const schema = z.object({
			cover: fileRef().optional(),
			pages: z.array(fileRef()).readonly(),
			back: fileRef().nullable(),
			inner: z.object({ scan: fileRef().default(file("default")) }).nullable(),
		});

		expect(
			markedFiles(schema, {
				cover: file("a"),
				pages: [file("b"), file("c")],
				back: null,
				inner: { scan: file("d") },
			}),
		).toEqual(["a", "b", "c", "d"]);
		expect(markedFiles(schema, { pages: [], back: null, inner: null })).toEqual([]);
	});

	it("keeps the mark through a description, and finds nothing at unmarked positions", () => {
		const schema = z.object({
			photo: fileRef().describe("the photo"),
			lookalike: z.object({
				id: z.string(),
				name: z.string(),
				type: z.string(),
				size: z.number(),
			}),
			ids: z.array(z.string()),
		});

		expect(markedFiles(schema, { photo: file("a"), lookalike: file("b"), ids: ["c"] })).toEqual(
			["a"],
		);
	});
});

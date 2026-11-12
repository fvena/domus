import { defineModule } from "@domus/module-sdk";
import { readAction, writeAction } from "@domus/module-sdk/contracts";
import { id, moduleTables, text } from "@domus/module-sdk/db";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { openPlatform, type Platform } from "../platform";
import { confirmPending, invokeAction, prepareAccount, syntheticContext } from "../testing";

const { table } = moduleTables("stamps");
const stamps = table("items", { id: id(), body: text().notNull() });

/** A module whose input schema transforms what it is given: each validation adds a "!". */
const stampsModule = defineModule({
	id: "stamps",
	schema: { stamps },
	migrations: [
		{
			tag: "0000_stamps",
			position: 0,
			hash: "hash-of-0000_stamps",
			statements: [
				"CREATE TABLE `stamps_items` (`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL, `body` text NOT NULL);",
			],
		},
	],
	contract: {
		stamp: writeAction({ undoable: false, level: "write", alwaysConfirm: true })
			.input(z.object({ body: z.string().transform((body) => `${body}!`) }))
			.output(z.string()),
		list: readAction({ level: "read" }).output(z.array(z.string())),
	},
	actions: {
		stamp: ({ db, input }) => {
			db.insert(stamps).values({ body: input.body }).run();
			return { result: input.body, touched: [] };
		},
		list: ({ db }) =>
			db
				.select()
				.from(stamps)
				.all()
				.map((row) => row.body),
	},
});

let platform: Platform | undefined;

afterEach(() => {
	platform?.close();
	platform = undefined;
});

function open(): Platform {
	platform = openPlatform(
		{ databaseFile: ":memory:", modules: [stampsModule] },
		{ clock: () => Date.UTC(2026, 10, 12) },
	);
	prepareAccount(platform, { id: "ana", name: "Ana", email: "ana@domus.test", role: "member" });
	return platform;
}

const ana = syntheticContext({
	account: "ana",
	device: "d1",
	deviceAccount: "ana",
	channel: "app",
	identity: "password",
});

/** The id of the pending confirmation the call answers with. */
function pendingOf(call: () => unknown): string {
	try {
		call();
	} catch (error) {
		expect(error).toMatchObject({ code: "CONFIRMATION_REQUIRED", status: 428 });
		return (error as { data: { confirmation: string } }).data.confirmation;
	}
	throw new Error("expected CONFIRMATION_REQUIRED");
}

describe("a pending confirmation with a schema that transforms the input", () => {
	it("runs exactly the validated input it was asked with, not that input validated again", () => {
		const platform = open();
		const stamp = (body: string, key: string) => () =>
			invokeAction(platform, {
				context: ana,
				action: "stamps.stamp",
				input: { body },
				idempotencyKey: key,
			});

		const first = pendingOf(stamp("a", "k1"));
		// "a!" validates to "a!!": another operation, even if its raw input is what the first validated to.
		const second = pendingOf(stamp("a!", "k2"));
		expect(second).not.toBe(first);
		expect(() => stamp("a!", "k1")()).toThrow(
			expect.objectContaining({ code: "CONFLICT", data: { reason: "key-reused" } }),
		);

		expect(confirmPending(platform, { context: ana, confirmation: first })).toEqual({
			result: "a!",
			entry: 1,
		});
		expect(invokeAction(platform, { context: ana, action: "stamps.list" })).toEqual(["a!"]);
	});
});

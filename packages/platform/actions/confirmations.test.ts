import { defineModule } from "@domus/module-sdk";
import { readAction, writeAction } from "@domus/module-sdk/contracts";
import { id, moduleTables, text } from "@domus/module-sdk/db";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { connectionOf, openPlatform, type Platform } from "../platform";
import {
	confirmPending,
	deviceAccountOf,
	invokeAction,
	prepareAccount,
	prepareDelegation,
	readLog,
	readPendingConfirmations,
	rejectPending,
	syntheticContext,
} from "../testing";

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

/** A module whose own area declares the shared device rule, and a write that always asks for confirmation. */
const vitalsModule = defineModule({
	id: "vitals",
	areas: { vitals: { confirmOnSharedDevice: true } },
	schema: {},
	migrations: [],
	contract: {
		read: readAction({ level: "read" }).output(z.string()),
		note: writeAction({ undoable: false, level: "write", alwaysConfirm: true }).output(
			z.string(),
		),
	},
	actions: {
		read: () => "tensión 12/8",
		note: () => ({ result: "anotado", touched: [] }),
	},
});

describe("pending confirmations on a shared device", () => {
	const notFound = expect.objectContaining({ code: "NOT_FOUND" });

	function withVitals() {
		const opened = openPlatform(
			{ databaseFile: ":memory:", modules: [vitalsModule] },
			{ clock: () => Date.UTC(2026, 10, 12) },
		);
		platform = opened;
		prepareAccount(opened, { id: "ana", name: "Ana", email: "ana@domus.test", role: "member" });
		prepareDelegation(opened, "ana", "vitals", "read", "confirm");
		return opened;
	}

	it("are born to be answered from the app, also one asked via Kira on the kitchen screen", () => {
		const platform = withVitals();
		const onScreen = syntheticContext({
			account: "ana",
			via: "kira",
			device: "kitchen",
			deviceAccount: deviceAccountOf(platform),
			channel: "app",
			identity: "password",
		});
		const pending = pendingOf(() =>
			invokeAction(platform, { context: onScreen, action: "vitals.read" }),
		);

		expect(confirmPending(platform, { context: ana, confirmation: pending })).toBe(
			"tensión 12/8",
		);
	});

	it("leave one born before phase 1f to be confirmed only in context unanswered from the app", () => {
		const platform = withVitals();
		const pending = pendingOf(() =>
			invokeAction(platform, { context: ana, action: "vitals.note", idempotencyKey: "k1" }),
		);
		// What the shared device rule left in the database before phase 1f.
		connectionOf(platform)
			.prepare("UPDATE platform_confirmations SET context_only = 1 WHERE id = ?")
			.run(pending);
		const stored = readPendingConfirmations(platform);

		expect(() => confirmPending(platform, { context: ana, confirmation: pending })).toThrow(
			notFound,
		);
		expect(() => rejectPending(platform, { context: ana, confirmation: pending })).toThrow(
			notFound,
		);
		expect(readPendingConfirmations(platform)).toEqual(stored);
		expect(readLog(platform)).toEqual([]);
	});
});

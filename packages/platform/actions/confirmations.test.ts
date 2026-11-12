import { defineModule } from "@domus/module-sdk";
import { readAction, writeAction } from "@domus/module-sdk/contracts";
import { id, moduleTables, text } from "@domus/module-sdk/db";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { openPlatform, type Platform } from "../platform";
import {
	confirmPending,
	deviceAccountOf,
	invokeAction,
	prepareAccount,
	prepareDelegation,
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

/** A module whose own area asks for confirmation to be read on a shared device. */
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

describe("a pending confirmation born of the shared device rule", () => {
	const WINDOW = 60 * 1000;
	const notFound = expect.objectContaining({ code: "NOT_FOUND" });
	const conflict = (reason: string) =>
		expect.objectContaining({ code: "CONFLICT", data: { reason } });

	/** Ana recognized by voice on the kitchen screen, signed in with the device account; `ana` is her phone. */
	function kitchen() {
		let now = Date.UTC(2026, 10, 12);
		const opened = openPlatform(
			{ databaseFile: ":memory:", modules: [vitalsModule] },
			{ clock: () => now },
		);
		platform = opened;
		prepareAccount(opened, { id: "ana", name: "Ana", email: "ana@domus.test", role: "member" });
		prepareDelegation(opened, "ana", "vitals", "read", "yes");
		prepareDelegation(opened, "ana", "vitals", "write", "yes");
		const voice = syntheticContext({
			account: "ana",
			via: "kira",
			device: "kitchen",
			deviceAccount: deviceAccountOf(opened),
			channel: "contexto",
			identity: "voice",
			conversation: "c1",
		});
		const readOnScreen = () =>
			pendingOf(() => invokeAction(opened, { context: voice, action: "vitals.read" }));
		return {
			platform: opened,
			voice,
			readOnScreen,
			advance: (milliseconds: number) => {
				now += milliseconds;
			},
		};
	}

	it("is not found from the app, not even from the member's own phone, which reads anew instead", () => {
		const { platform: opened, readOnScreen } = kitchen();
		const pending = readOnScreen();

		expect(() => confirmPending(opened, { context: ana, confirmation: pending })).toThrow(
			notFound,
		);
		expect(() => rejectPending(opened, { context: ana, confirmation: pending })).toThrow(
			notFound,
		);
		expect(invokeAction(opened, { context: ana, action: "vitals.read" })).toBe("tensión 12/8");
	});

	it("is confirmed once in context while its window is open", () => {
		const { platform: opened, voice, readOnScreen, advance } = kitchen();
		const pending = readOnScreen();
		advance(WINDOW - 1);

		expect(confirmPending(opened, { context: voice, confirmation: pending })).toBe(
			"tensión 12/8",
		);
		expect(() => confirmPending(opened, { context: voice, confirmation: pending })).toThrow(
			conflict("confirmation-consumed"),
		);
	});

	it("expires the millisecond its window closes, for every channel", () => {
		const { platform: opened, voice, readOnScreen, advance } = kitchen();
		const pending = readOnScreen();
		advance(WINDOW);

		expect(() => confirmPending(opened, { context: voice, confirmation: pending })).toThrow(
			conflict("confirmation-expired"),
		);
		expect(() => confirmPending(opened, { context: ana, confirmation: pending })).toThrow(
			notFound,
		);
	});

	it("leaves any other pending of the same screen confirmable from the app within its 24 h", () => {
		const { platform: opened, voice, advance } = kitchen();
		const pending = pendingOf(() =>
			invokeAction(opened, { context: voice, action: "vitals.note", idempotencyKey: "k1" }),
		);
		advance(WINDOW);

		expect(confirmPending(opened, { context: ana, confirmation: pending })).toEqual({
			result: "anotado",
			entry: 1,
		});
	});
});

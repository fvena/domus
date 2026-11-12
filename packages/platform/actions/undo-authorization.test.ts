// The inverse of an undo passes the whole authorization and the write capture (ADR 0023), with the real
// authorizer. A module written here, `ledger`, has what probe cannot show: a write declared in one area that edits
// records of another, and an undoable action of level manage.
import { defineModule } from "@domus/module-sdk";
import { writeAction } from "@domus/module-sdk/contracts";
import { and, eq, id, integer, moduleTables, text } from "@domus/module-sdk/db";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import type { Platform } from "../platform";
import {
	createPlatformWithClock,
	invokeAction,
	moduleDatabase,
	prepareAccount,
	prepareGrant,
	preparePassword,
	prepareSession,
	readLog,
	requestProofOf,
	syntheticContext,
	undoEntry,
	type VerifiedContext,
} from "../testing";

const areas = {
	ledger: {},
	/** Public by default; anyone with `write` edits a public post. */
	"ledger.board": { defaultVisibility: "public", publicEditable: true },
} as const;
const { ownedTable, table } = moduleTables("ledger", areas);
const posts = ownedTable(
	"posts",
	{ type: "post", area: "ledger.board" },
	{ body: text().notNull() },
);
const locks = table("locks", { id: id(), locked: integer().notNull() });
const schema = { posts, locks };

const ledger = defineModule({
	id: "ledger",
	areas,
	schema,
	migrations: [
		{
			tag: "0000_ledger",
			position: 0,
			hash: "hash-of-0000_ledger",
			statements: [
				"CREATE TABLE `ledger_posts` (`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL, `body` text NOT NULL, `owner` text NOT NULL, `visibility` text NOT NULL);",
				"CREATE TABLE `ledger_locks` (`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL, `locked` integer NOT NULL);",
				"INSERT INTO `ledger_locks` (`locked`) VALUES (0);",
			],
		},
	],
	contract: {
		/** Declared in `ledger`, it edits a post of `ledger.board`. Undone by editing it back. */
		rewrite: writeAction({ undoable: true, level: "write" })
			.input(z.object({ id: z.number(), body: z.string() }))
			.output(z.object({ id: z.number() })),
		/** A setting of level manage. Undone by setting it back, which is of level manage too. */
		lock: writeAction({ undoable: true, level: "manage" })
			.input(z.object({ locked: z.boolean() }))
			.output(z.object({ locked: z.boolean() })),
	},
	actions: {
		rewrite: ({ db, input, visible }) => {
			const before = db
				.select({ body: posts.body })
				.from(posts)
				.where(and(eq(posts.id, input.id), visible(posts)))
				.get();
			db.update(posts).set({ body: input.body }).where(eq(posts.id, input.id)).run();
			return {
				result: { id: input.id },
				touched: [{ type: "post", id: input.id }],
				inverse: {
					action: "ledger.rewrite",
					input: { id: input.id, body: before?.body ?? "" },
				},
			};
		},
		lock: ({ db, input }) => {
			const before = db.select().from(locks).where(eq(locks.id, 1)).get();
			db.update(locks)
				.set({ locked: input.locked ? 1 : 0 })
				.where(eq(locks.id, 1))
				.run();
			return {
				result: { locked: input.locked },
				touched: [{ type: "lock", id: 1 }],
				inverse: { action: "ledger.lock", input: { locked: before?.locked === 1 } },
			};
		},
	},
});

let platform: Platform | undefined;
afterEach(() => {
	platform?.close();
	platform = undefined;
});

const forbidden = expect.objectContaining({ code: "FORBIDDEN" });
const stepUp = expect.objectContaining({ code: "STEP_UP_REQUIRED" });

/** A platform with ledger, the admin Ana and the member Bea, and Bea's public post 1. */
function household() {
	const opened = createPlatformWithClock({ databaseFile: ":memory:", modules: [ledger] }, () =>
		Date.UTC(2026, 10, 12),
	);
	platform = opened;
	prepareAccount(opened, { id: "ana", name: "Ana", email: "ana@domus.test", role: "admin" });
	prepareAccount(opened, { id: "bea", name: "Bea", email: "bea@domus.test", role: "member" });
	moduleDatabase(opened, ledger)
		.insert(posts)
		.values({ owner: "bea", visibility: "public", body: "turnos" })
		.run();
	return opened;
}

/** A context of the account through the app, with a real session. */
function contextOf(opened: Platform, account: string): VerifiedContext {
	const { session, device } = prepareSession(opened, account);
	return syntheticContext({
		account,
		device,
		session,
		deviceAccount: account,
		channel: "app",
		identity: "password",
	});
}

describe("the inverse of an undo", () => {
	it("of an action of level manage needs a step-up proof of that undo", async () => {
		const opened = household();
		await preparePassword(opened, "ana", "contraseña de ana");
		const ana = contextOf(opened, "ana");
		const locking = { action: "ledger.lock", input: { locked: true } };
		const { proof } = await requestProofOf(opened, ana, {
			password: "contraseña de ana",
			operation: locking,
		});
		invokeAction(opened, { context: ana, ...locking, idempotencyKey: "k1", proof });

		expect(() => undoEntry(opened, { context: ana, entry: 1, idempotencyKey: "u1" })).toThrow(
			stepUp,
		);
		const undoProof = await requestProofOf(opened, ana, {
			password: "contraseña de ana",
			operation: { undo: 1 },
		});
		expect(
			undoEntry(opened, {
				context: ana,
				entry: 1,
				idempotencyKey: "u1",
				proof: undoProof.proof,
			}),
		).toEqual({ result: { locked: false }, entry: 2 });
		expect(moduleDatabase(opened, ledger).select().from(locks).all()).toEqual([
			{ id: 1, locked: 0 },
		]);
	});

	it("that breaks a rule of visibility rolls back, though its own area allows it", () => {
		const opened = household();
		prepareAccount(opened, { id: "eva", name: "Eva", email: "eva@domus.test", role: "member" });
		const eva = contextOf(opened, "eva");
		invokeAction(opened, {
			context: eva,
			action: "ledger.rewrite",
			input: { id: 1, body: "turnos de cocina" },
			idempotencyKey: "k1",
		});
		// Eva keeps `write` in the area of the action, but no longer in the area of Bea's post.
		prepareGrant(opened, "eva", "ledger.board", "read");
		const before = readLog(opened);

		expect(() => undoEntry(opened, { context: eva, entry: 1, idempotencyKey: "u1" })).toThrow(
			forbidden,
		);
		expect(moduleDatabase(opened, ledger).select().from(posts).all()).toEqual([
			{ id: 1, owner: "bea", visibility: "public", body: "turnos de cocina" },
		]);
		expect(readLog(opened)).toEqual(before);
	});
});

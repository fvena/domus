// Answering a pending confirmation (ADR 0023): confirming runs its operation once on the path of the actions,
// evaluated again with the account, via and delegation it was born with; rejecting closes it. Who may answer
// which one, and until when, is decided here; the operation itself runs through the path's own read, write or
// undo.
import { ORPCError } from "@orpc/server";
import type Database from "better-sqlite3";

import { isVerified, sealContext, type VerifiedContext } from "../authorization";
import type { Confirmations, PendingConfirmation } from "./confirmations";
import { conflict, internalError } from "./failures";
import type { RegisteredAction } from "./registry";

/**
 * Confirming or rejecting a pending confirmation: who asks, through which channel, and its id. By the app, the
 * same account without via, from any of its sessions; in context, the same account on the same device in the
 * same conversation while the window is open.
 */
export interface ConfirmationCall {
	readonly context: VerifiedContext;
	readonly confirmation: string;
	/** The step-up proof of the pending operation, when it is sensitive: it is asked for when confirming. */
	readonly proof?: string;
}

/** What answering runs an operation with: the path's own read, write and undo, each confirmed. */
export interface AnsweringPath {
	readonly connection: Database.Database;
	readonly confirmations: Confirmations;
	readonly clock: () => number;
	readonly registry: ReadonlyMap<string, RegisteredAction>;
	readonly read: (
		found: RegisteredAction,
		context: VerifiedContext,
		action: string,
		input: unknown,
		options: { readonly proof?: string; readonly confirmed: true },
	) => unknown;
	readonly write: (
		found: RegisteredAction,
		context: VerifiedContext,
		action: string,
		input: unknown,
		options: {
			readonly idempotencyKey: string | undefined;
			readonly proof?: string;
			readonly confirmed: true;
		},
	) => { readonly entry: number };
	readonly undo: (
		call: {
			readonly context: VerifiedContext;
			readonly entry: number;
			readonly idempotencyKey: string;
			readonly proof?: string;
		},
		confirmed: true,
	) => { readonly entry: number };
}

export interface Answering {
	confirm(call: ConfirmationCall): unknown;
	reject(call: ConfirmationCall): void;
}

export function answeringWith({
	connection,
	confirmations,
	clock,
	registry,
	read,
	write,
	undo,
}: AnsweringPath): Answering {
	return {
		/**
		 * Confirms a pending confirmation and runs its operation on the path of the actions, in one transaction
		 * with consuming it: a write logs its entry with the key it was asked with and the confirmation links to
		 * it; a read runs with `query_only` and only then, outside that stretch, is the confirmation consumed. It
		 * is evaluated again with the account, via and delegation of its origin and the rest of the context of
		 * now; the requirement to confirm counts as met, and nothing else does.
		 */
		confirm: ({ context, confirmation, proof }) => {
			if (!isVerified(context)) throw internalError();
			return connection.transaction(() => {
				const pending = reachable(context, confirmation);
				const asked = sealContext({
					...context,
					account: pending.origin.account,
					...(pending.origin.via === undefined
						? { via: undefined }
						: { via: pending.origin.via }),
				});
				const { operation } = pending;
				// Emptied only once it expired, which `reachable` already answered.
				if (operation === undefined) throw internalError();
				if ("undo" in operation) {
					const outcome = undo(
						{
							context: asked,
							entry: operation.undo,
							idempotencyKey: pending.key ?? "",
							...(proof === undefined ? {} : { proof }),
						},
						true,
					);
					confirmations.consume(pending.id, outcome.entry);
					return outcome;
				}
				const found = registry.get(operation.action);
				if (!found || found.kind !== pending.kind) throw internalError();
				if (found.kind === "read") {
					const result = read(found, asked, operation.action, operation.input, {
						...(proof === undefined ? {} : { proof }),
						confirmed: true,
					});
					confirmations.consume(pending.id, undefined);
					return result;
				}
				const outcome = write(found, asked, operation.action, operation.input, {
					idempotencyKey: pending.key,
					...(proof === undefined ? {} : { proof }),
					confirmed: true,
				});
				confirmations.consume(pending.id, outcome.entry);
				return outcome;
			})();
		},
		reject: ({ context, confirmation }) => {
			if (!isVerified(context)) throw internalError();
			connection.transaction(() => {
				confirmations.reject(reachable(context, confirmation).id);
			})();
		},
	};

	/**
	 * The pending confirmation `context` may answer, still waiting. Another account's, or one out of reach of
	 * this channel, is not found: by the app, only the account itself without via, and never one confirmed only
	 * in context; in context, only the same device and the same, not empty, conversation.
	 */
	function reachable(context: VerifiedContext, id: string): PendingConfirmation {
		const pending = confirmations.find(id);
		const { origin } = pending ?? {};
		const inReach =
			pending !== undefined &&
			origin !== undefined &&
			pending.account === context.account &&
			(context.channel === "app"
				? context.via === undefined && !pending.contextOnly
				: context.device === origin.device &&
					context.conversation !== undefined &&
					context.conversation !== "" &&
					context.conversation === origin.conversation);
		if (!inReach || pending === undefined)
			throw new ORPCError("NOT_FOUND", { message: `no pending confirmation "${id}"` });

		const now = clock();
		if (pending.state === "consumed" || pending.state === "rejected")
			throw conflict("confirmation-consumed");
		if (pending.state === "ended" || now >= pending.expiresAt)
			throw conflict("confirmation-expired");
		if (context.channel === "contexto" && now >= pending.windowClosesAt)
			throw conflict("window-closed");
		return pending;
	}
}

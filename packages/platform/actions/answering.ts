// Answering a pending confirmation (ADR 0023): confirming runs its operation once on the path of the actions,
// evaluated again with the account, via and delegation it was born with; rejecting closes it. Who may answer
// which one, and until when, is decided here; the operation itself runs through the path's own read, write or
// undo.
import { ORPCError } from "@orpc/server";
import type Database from "better-sqlite3";

import { isVerified, sealContext, type VerifiedContext } from "../authorization";
import type { OpenedContent } from "../files/store";
import type { FileDescription } from "../files/type";
import {
	type Confirmations,
	isDownload,
	type PendingConfirmation,
	type PendingDownload,
} from "./confirmations";
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
	/**
	 * Runs a download's read and opens its file, inside the caller's transaction (ADR 0028). The caller closes
	 * the descriptor if that transaction rolls back.
	 */
	readonly download: (
		found: RegisteredAction,
		context: VerifiedContext,
		operation: PendingDownload,
		options: { readonly proof?: string; readonly confirmed: true },
	) => Download;
}

/** A file ready to send: its open content and what the answer says of it. */
export interface Download extends FileDescription {
	readonly content: OpenedContent;
}

/**
 * Runs `work` in a transaction of `connection`, which opens a download's file through `opened` and may go on after
 * it: if the transaction rolls back once the file is open, the file is closed, since nobody sends it.
 */
export function openingDownload(
	connection: Database.Database,
	work: (opened: (download: Download) => Download) => Download,
): Download {
	let open: Download | undefined;
	try {
		return connection.transaction(() => work((download) => (open = download)))();
	} catch (error) {
		open?.content.close();
		throw error;
	}
}

export interface Answering {
	confirm(call: ConfirmationCall): unknown;
	/** Confirms a pending download and returns its file, open, for the caller to send after the transaction. */
	confirmDownload(call: ConfirmationCall): Download;
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
	download,
}: AnsweringPath): Answering {
	return {
		/**
		 * Confirms a pending confirmation and runs its operation on the path of the actions, in one transaction
		 * with consuming it: a write logs its entry with the key it was asked with and the confirmation links to
		 * it; a read runs with `query_only` and only then, outside that stretch, is the confirmation consumed. It
		 * is evaluated again with the account, via and delegation of its origin and the rest of the context of
		 * now; the requirement to confirm counts as met, and nothing else does. A pending download is confirmed
		 * only through its own route, which this refuses without consuming it.
		 */
		confirm: ({ context, confirmation, proof }) => {
			if (!isVerified(context)) throw internalError();
			return connection.transaction(() => {
				const pending = reachable(context, confirmation);
				const asked = askedBy(context, pending);
				const operation = operationOf(pending);
				if (isDownload(operation)) throw conflict("confirm-by-download");
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
		/**
		 * Confirms a pending download (ADR 0028): its read runs again as {@link Answering.confirm} runs one, and
		 * running it, checking it returned the file, opening that file and consuming the confirmation go in one
		 * transaction. A response lost after it leaves the confirmation consumed. Any other pending operation is not
		 * found here.
		 */
		confirmDownload: ({ context, confirmation, proof }) => {
			if (!isVerified(context)) throw internalError();
			return openingDownload(connection, (opened) => {
				const pending = reachable(context, confirmation);
				const operation = operationOf(pending);
				if (!isDownload(operation))
					throw new ORPCError("NOT_FOUND", {
						message: `no pending download "${confirmation}"`,
					});
				const found = registry.get(operation.action);
				if (!found || found.kind !== "read") throw internalError();
				const ready = opened(
					download(found, askedBy(context, pending), operation, {
						...(proof === undefined ? {} : { proof }),
						confirmed: true,
					}),
				);
				confirmations.consume(pending.id, undefined);
				return ready;
			});
		},
		reject: ({ context, confirmation }) => {
			if (!isVerified(context)) throw internalError();
			connection.transaction(() => {
				confirmations.reject(reachable(context, confirmation).id);
			})();
		},
	};

	/** The context a pending operation runs in: the one of now, with the account and via of its origin. */
	function askedBy(context: VerifiedContext, pending: PendingConfirmation): VerifiedContext {
		return sealContext({
			...context,
			account: pending.origin.account,
			...(pending.origin.via === undefined
				? { via: undefined }
				: { via: pending.origin.via }),
		});
	}

	/** What a reachable pending confirmation runs: emptied only once it expired, which `reachable` answers first. */
	function operationOf(pending: PendingConfirmation) {
		if (pending.operation === undefined) throw internalError();
		return pending.operation;
	}

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

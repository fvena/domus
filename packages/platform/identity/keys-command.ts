// `pnpm keys` (ADR 0030): the one procedure that creates, lists and revokes the keys of the connected apps. Its core
// takes the platform and an output; the wrapper in apps/api only wires them. It asks nothing, so it needs no
// terminal. stdout carries only what the command is for, the new key alone or the listing, so that `create` can be
// redirected to the secret's file without the key crossing the screen; every message and error goes to stderr. No
// line carries a secret but the new key.

import { clockOf, connectionOf, type Platform } from "../platform";
import { CONNECTED_APPS, createKey, type ListedKey, listKeys, revokeKey } from "./keys";

/** How the command talks to the operator. */
export interface KeysTerminal {
	/** Writes one line to stdout: the new key, or a line of the listing. */
	print(line: string): void;
	/** Writes one line of message to stderr. */
	inform(line: string): void;
	/** Writes one line of error to stderr. */
	fail(line: string): void;
}

/** What the command is asked to do, once its arguments are read. */
export type KeysCommand =
	| { readonly kind: "create"; readonly app: string }
	| { readonly kind: "list" }
	| { readonly kind: "revoke"; readonly id: string };

/** The arguments read, or why they were refused. An error never repeats an argument. */
export type ParsedKeysArguments = { readonly command: KeysCommand } | { readonly error: string };

/** How the command is called, for the operator. */
export const KEYS_USAGE = [
	"usage:",
	`  keys create <app>    app: ${CONNECTED_APPS.map(({ name }) => name).join(", ")}; writes only the key to stdout`,
	"  keys list",
	"  keys revoke <id>     the id as list shows it",
].join("\n");

/** Reads the command's arguments: a subcommand and its one argument, if it takes one. */
export function parseKeysArguments(args: readonly string[]): ParsedKeysArguments {
	const [subcommand, argument, ...rest] = args;
	if (subcommand === undefined)
		return { error: "keys needs a subcommand: create, list or revoke" };
	if (subcommand === "create") {
		if (argument === undefined) return { error: `create needs an app: ${APP_NAMES}` };
		if (rest.length > 0) return { error: "create takes one app" };
		return { command: { kind: "create", app: argument } };
	}
	if (subcommand === "list") {
		if (argument !== undefined) return { error: "list takes no arguments" };
		return { command: { kind: "list" } };
	}
	if (subcommand === "revoke") {
		if (rest.length > 0) return { error: "revoke takes one id" };
		// A whole key given instead of its id is refused without being repeated.
		if (argument === undefined || !KEY_ID.test(argument))
			return { error: "revoke needs the id of a key, as list shows it" };
		return { command: { kind: "revoke", id: argument } };
	}
	return { error: "unknown subcommand: use create, list or revoke" };
}

/** The names of the connected apps, for the operator. */
const APP_NAMES = CONNECTED_APPS.map(({ name }) => name).join(", ");

/** The form of a key's id: 8 bytes in base64url. */
const KEY_ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * The form of an app's name, which neither a key nor its secret, of 43 characters, ever has: an argument of another
 * form is not repeated.
 */
const APP_NAME = /^[a-z][a-z0-9-]{0,31}$/;

/**
 * Runs one command on the platform and returns its exit code: 0 when done, 1 when refused. No line it writes
 * carries a secret but the key `create` writes to stdout.
 */
export function runKeys(platform: Platform, command: KeysCommand, terminal: KeysTerminal): number {
	try {
		const connection = connectionOf(platform);
		const now = clockOf(platform);
		if (command.kind === "create") {
			if (!CONNECTED_APPS.some(({ name }) => name === command.app)) {
				const which = APP_NAME.test(command.app) ? command.app : "that";
				return refuse(terminal, `${which} is not a connected app: use ${APP_NAMES}`);
			}
			const key = createKey(connection, CONNECTED_APPS, command.app, now());
			terminal.print(key);
			return 0;
		}

		if (command.kind === "list") {
			const listed = listKeys(connection);
			if (listed.length === 0) terminal.inform("no keys");
			for (const key of listed) terminal.print(lineOf(key));
			return 0;
		}

		const revoked = revokeKey(connection, command.id, now());
		if (revoked.kind === "unknown") return refuse(terminal, `no key has the id ${command.id}`);
		if (revoked.kind === "already")
			terminal.inform(
				`the key ${command.id} was already revoked at ${instant(revoked.revokedAt)}: nothing changed`,
			);
		else terminal.inform(`revoked the key ${command.id} of ${revoked.app}`);
		return 0;
	} catch {
		// An unexpected error's message is not shown: nothing guarantees it leaves the new key out.
		return refuse(
			terminal,
			"the command stopped before finishing: run list to see what is there",
		);
	}
}

/** One line of the listing: the id, the app, the creation, the last use or none, and live or revoked. */
function lineOf(key: ListedKey): string {
	return [
		key.id,
		key.app,
		`created ${instant(key.createdAt)}`,
		key.lastUsedAt === null ? "never used" : `last used ${instant(key.lastUsedAt)}`,
		key.revokedAt === null ? "live" : `revoked ${instant(key.revokedAt)}`,
	].join("  ");
}

function instant(milliseconds: number): string {
	return new Date(milliseconds).toISOString();
}

function refuse(terminal: KeysTerminal, reason: string): number {
	terminal.fail(reason);
	return 1;
}

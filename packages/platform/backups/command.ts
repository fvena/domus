// `restore.mjs` (ADR 0026): lists the snapshots of host `domus`, or restores the latest or one of them. Its core takes
// the paths and an output; the wrapper in apps/api only wires them. It reads no other argument: production has no way
// to reach the cut points of the tests. Its lines are in English.
import type { ModuleDefinition } from "@domus/module-sdk";

import type { BackupConfig } from "./restic";
import { listSnapshots, restore } from "./restore";

/** What the command was asked to do. */
export type RestoreCommand =
	| { readonly kind: "list" }
	| { readonly kind: "restore"; readonly snapshot?: string };

export const RESTORE_USAGE = `usage:
  restore list                    the snapshots of host domus, with their capture
  restore [--snapshot <id>]       restore the latest snapshot, or the one given (an id or its start)`;

/** Reads the arguments, without the program's: a command, or what is wrong with them. */
export function parseRestoreArguments(
	argv: readonly string[],
): RestoreCommand | { readonly error: string } {
	const [first, ...rest] = argv;
	if (first === "list")
		return rest.length === 0 ? { kind: "list" } : { error: "list takes no arguments" };
	if (first === undefined) return { kind: "restore" };
	if (first !== "--snapshot") return { error: `unexpected argument: ${first}` };
	const [snapshot, ...more] = rest;
	if (!snapshot || !/^[0-9a-f]+$/i.test(snapshot))
		return { error: "--snapshot needs a snapshot id" };
	if (more[0] !== undefined) return { error: `unexpected argument: ${more[0]}` };
	return { kind: "restore", snapshot };
}

/** What the command works on. */
export interface RestoreTarget {
	readonly databaseFile: string;
	readonly modules: readonly ModuleDefinition[];
	readonly backups: BackupConfig;
}

/** How the command talks to the operator. */
export interface RestoreTerminal {
	print(line: string): void;
	fail(line: string): void;
}

/** Runs the command and returns its exit code: 0 when done, 1 when it failed or refused. */
export async function runRestoreCommand(
	command: RestoreCommand,
	{ databaseFile, modules, backups }: RestoreTarget,
	terminal: RestoreTerminal,
): Promise<number> {
	try {
		if (command.kind === "list") {
			const snapshots = await listSnapshots(backups, { clock: Date.now });
			if (snapshots.length === 0) terminal.print("no snapshots of host domus yet");
			for (const { id, capturedAt } of snapshots)
				terminal.print(`${id}  captured ${new Date(capturedAt).toISOString()}`);
			return 0;
		}
		const done = await restore({
			databaseFile,
			modules,
			backups,
			...(command.snapshot === undefined ? {} : { snapshot: command.snapshot }),
		});
		const captured = new Date(done.capturedAt).toISOString();
		terminal.print(
			done.resumed
				? `ended the restore of ${done.snapshot}, captured ${captured}, that was cut`
				: `restored ${done.snapshot}, captured ${captured}`,
		);
		terminal.print(`the previous database is kept in ${done.preserved}`);
		return 0;
	} catch (error) {
		terminal.fail(error instanceof Error ? error.message : String(error));
		return 1;
	}
}

// The staging folders of the backups and of restoring (ADR 0026): each a fixed folder of the data folder that holds
// one copy of the database, named as it is at the root of every snapshot.
import { mkdirSync, rmSync } from "node:fs";

/** The copy's name, in a staging folder and in each restic snapshot, at its root. */
export const SNAPSHOT_FILE = "domus.db";

/** Removes the folder with whatever it holds and creates it again, empty. */
export function emptyFolder(folder: string): void {
	rmSync(folder, { recursive: true, force: true });
	mkdirSync(folder, { recursive: true });
}

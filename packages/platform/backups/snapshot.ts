// The snapshot of a backup (ADR 0026): `db.backup()` copies the live database page by page, between turns of the
// event loop, so `api` keeps answering. `quick_check` runs in a child Node process, which opens the snapshot read
// only: in `api` it would hold its one thread for the whole walk.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

/** better-sqlite3 as this file resolves it: in the image, the copy next to the bundle. */
const SQLITE = createRequire(import.meta.url).resolve("better-sqlite3");

/**
 * The child's program: it opens the file read only, prints the first line of `quick_check` and exits. Any failure,
 * opening a file that is no database included, ends it with another code.
 */
const QUICK_CHECK = `
const [sqlite, file] = process.argv.slice(1);
const Database = require(sqlite);
const db = new Database(file, { readonly: true, fileMustExist: true });
const result = db.pragma("quick_check", { simple: true });
db.close();
process.stdout.write(String(result));
`;

/** True when `quick_check` of the snapshot at `file` says `ok`, checked in a child process. */
export function passesQuickCheck(file: string): Promise<boolean> {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, ["-e", QUICK_CHECK, SQLITE, file], {
			env: {},
			stdio: ["ignore", "pipe", "ignore"],
		});
		const chunks: Buffer[] = [];
		child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
		child.on("error", reject);
		child.on("close", (code) =>
			resolve(code === 0 && Buffer.concat(chunks).toString("utf8") === "ok"),
		);
	});
}

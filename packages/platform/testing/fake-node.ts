// A Node executable for the backups' child processes (ADR 0027) that can stop the snapshot's child at its copy, or
// spoil the copy it made. Stopped, the child has taken the shared lock and opened the database, and waits before
// `VACUUM INTO` until the test lets it go. A shell script runs this process's own Node with a preload that wraps
// better-sqlite3's `prepare`, and notes each child it runs, `snapshot` or `quick_check`, in order. Only for tests:
// production runs this process's own Node.
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The preload: it wraps the statement of the copy, as the script's environment says. */
const PRELOAD = `
const Module = require("node:module");
const { closeSync, existsSync, fstatSync, openSync, renameSync, writeFileSync, writeSync } = require("node:fs");
const { join } = require("node:path");
const dir = process.env.DOMUS_FAKE_NODE;
const pauses = process.env.DOMUS_FAKE_NODE_PAUSE === "1";
const spoils = process.env.DOMUS_FAKE_NODE_SPOIL === "1";
const load = Module._load;
let wrapped = false;
Module._load = function (request, ...rest) {
	const exported = load.call(this, request, ...rest);
	if (!wrapped && request.includes("better-sqlite3")) {
		wrapped = true;
		const prepare = exported.prototype.prepare;
		exported.prototype.prepare = function (sql, ...more) {
			const statement = prepare.call(this, sql, ...more);
			if (!String(sql).startsWith("VACUUM INTO")) return statement;
			if (pauses) pause();
			if (spoils) {
				const run = statement.run;
				statement.run = function (target, ...others) {
					const result = run.call(this, target, ...others);
					spoil(target);
					return result;
				};
			}
			return statement;
		};
	}
	return exported;
};
function pause() {
	writeFileSync(join(dir, "pid.tmp"), String(process.pid));
	renameSync(join(dir, "pid.tmp"), join(dir, "pid"));
	const view = new Int32Array(new SharedArrayBuffer(4));
	while (!existsSync(join(dir, "go"))) Atomics.wait(view, 0, 0, 10);
}
function spoil(file) {
	const handle = openSync(file, "r+");
	const page = 4096;
	writeSync(handle, Buffer.alloc(page, 0xff), 0, page, fstatSync(handle).size - page);
	closeSync(handle);
}
`;

export interface FakeNodeOptions {
	/** Stop the snapshot's child at its copy, holding the lock, until {@link FakeNode.resume}. */
	readonly pause?: boolean;
	/** Overwrite the last page of the copy once it is made: `quick_check` no longer passes. */
	readonly spoilCopy?: boolean;
}

/** A Node executable for the backups' child processes. Use it with `using`: disposing removes it. */
export interface FakeNode extends Disposable {
	/** The executable, for the backups' option `node`. */
	readonly executable: string;
	/** The pid of the snapshot's child once it stopped at its copy; undefined before. */
	pausedChild(): number | undefined;
	/** Lets the stopped child copy, and every later one go on without stopping. */
	resume(): void;
	/** The children it ran, in order: `snapshot` or `quick_check`. */
	children(): string[];
}

export function fakeNode({ pause = false, spoilCopy = false }: FakeNodeOptions = {}): FakeNode {
	const dir = mkdtempSync(join(tmpdir(), "domus-fake-node-"));
	const path = (name: string) => join(dir, name);
	const preload = path("preload.cjs");
	writeFileSync(preload, PRELOAD);
	const executable = path("node");
	writeFileSync(
		executable,
		`#!/bin/sh
case "$*" in
	*"VACUUM INTO"*) echo snapshot >> '${path("children")}' ;;
	*quick_check*) echo quick_check >> '${path("children")}' ;;
esac
export DOMUS_FAKE_NODE='${dir}' DOMUS_FAKE_NODE_PAUSE=${pause ? 1 : 0} DOMUS_FAKE_NODE_SPOIL=${spoilCopy ? 1 : 0}
exec '${process.execPath}' --require '${preload}' "$@"
`,
	);
	chmodSync(executable, 0o755);
	return {
		executable,
		pausedChild: () =>
			existsSync(path("pid")) ? Number(readFileSync(path("pid"), "utf8")) : undefined,
		resume: () => writeFileSync(path("go"), ""),
		children: () =>
			existsSync(path("children"))
				? readFileSync(path("children"), "utf8").trim().split("\n")
				: [],
		[Symbol.dispose]: () => rmSync(dir, { recursive: true, force: true }),
	};
}

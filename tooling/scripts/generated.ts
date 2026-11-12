// What the generators of `modules/` share (ADR 0021): which folders are modules, and writing only what changed.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** The folders of `modules/` that have `file` (such as `server/schema.ts`), by name. */
export function moduleFolders(root: string, file: string): string[] {
	return readdirSync(join(root, "modules"), { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.filter((folder) => existsSync(join(root, "modules", folder, file)))
		.sort();
}

/** Writes `source` to `target` unless it already holds exactly that. Returns whether it wrote. */
export function writeIfChanged(target: string, source: string): boolean {
	if (existsSync(target) && readFileSync(target, "utf8") === source) return false;
	writeFileSync(target, source);
	return true;
}

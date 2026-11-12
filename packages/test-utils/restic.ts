// The tests of the backups use the real restic (ADR 0026): without it the suite fails, never skips them.
import { execFileSync } from "node:child_process";

/** Throws, with what to install, unless `restic version` answers. */
export function requireRestic(executable = "restic"): void {
	try {
		execFileSync(executable, ["version"], { stdio: "ignore" });
	} catch {
		throw new Error("restic is required: brew install restic");
	}
}

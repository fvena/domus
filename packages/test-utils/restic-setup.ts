// Vitest's global setup of test-utils: the whole run fails before any test when restic is missing.
import { requireRestic } from "./restic";

export default function setup(): void {
	requireRestic();
}

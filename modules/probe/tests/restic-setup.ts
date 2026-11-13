// Vitest's global setup of probe: the backups' tests with files run the real restic, so the whole run fails before
// any test when it is missing.
import { requireRestic } from "@domus/test-utils";

export default function setup(): void {
	requireRestic();
}

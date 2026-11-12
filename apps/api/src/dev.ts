// Start under `pnpm dev`: without DOMUS_DATA_DIR, the data lives in <repo>/data (git-ignored), worked out
// from this folder so it does not depend on where pnpm runs. Docker sets /data instead (ADR 0021).
import { mkdirSync } from "node:fs";
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

process.env.DOMUS_DATA_DIR ||= fileURLToPath(new URL("../../../data", import.meta.url));
const dataDir = process.env.DOMUS_DATA_DIR;
// A relative path is left for readConfig to reject.
if (isAbsolute(dataDir)) mkdirSync(dataDir, { recursive: true });

// Imported after the variable is set; a failure at start rejects and exits with an error, as in main.
void import("./main");

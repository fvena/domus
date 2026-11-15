// Start under `pnpm dev`. A relative DOMUS_API_KEY_FILE is read from the root of the repository, where
// `pnpm keys create kira > data/kira-key` writes it, not from this app's folder, where pnpm runs it. Docker reads
// the secret at /run/secrets/kira-key instead.
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../..", import.meta.url));
if (process.env.DOMUS_API_KEY_FILE) {
	process.env.DOMUS_API_KEY_FILE = resolve(root, process.env.DOMUS_API_KEY_FILE);
}

// Imported after the variable is set; a failure at start rejects and exits with an error, as in main.
void import("./main");

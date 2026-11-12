// Start under `pnpm dev`, with the development defaults of dev-env (ADR 0021).
import "./dev-env";

// Imported after the variables are set; a failure at start rejects and exits with an error, as in main.
void import("./main");

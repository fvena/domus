import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: true,
		clearMocks: false,
		environment: "node",
		// The backups' tests with files run the real restic: without it, the run fails with what to install.
		globalSetup: ["./tests/restic-setup.ts"],
	},
});

import { configDefaults, defineConfig } from "vitest/config";

// fixtures/ holds sample repositories that the tests read, not tests to run.
export default defineConfig({
	test: {
		globals: true,
		clearMocks: false,
		environment: "node",
		exclude: [...configDefaults.exclude, "fixtures/**"],
	},
});

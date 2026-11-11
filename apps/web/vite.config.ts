import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

// A SPA with no SSR. In development Vite serves it and passes the API through to apps/api;
// in production apps/api serves the built files.
export default defineConfig({
	plugins: [vue()],
	server: {
		proxy: {
			"/api": "http://localhost:3000",
			"/health": "http://localhost:3000",
		},
	},
});

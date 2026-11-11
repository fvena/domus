import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import App from "./App.vue";

describe("web", () => {
	it("renders the app shell", () => {
		expect(mount(App).get("h1").text()).toBe("Domus");
	});
});

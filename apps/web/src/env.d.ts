// For plain TypeScript tools (oxlint's type checking); vue-tsc reads the .vue files themselves.
declare module "*.vue" {
	import type { DefineComponent } from "vue";

	const component: DefineComponent;
	export default component;
}

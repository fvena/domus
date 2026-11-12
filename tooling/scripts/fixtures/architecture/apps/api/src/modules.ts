// The shape `pnpm modules:generate` writes, with one import that skips a module's server entry: the rule
// api-reaches-modules-through-server-entry must catch it in the generated list too.
import calendarModule from "../../../modules/calendar/server/index.ts";
import listsModule from "../../../modules/lists/server/internal.ts";

export const modules = [calendarModule, listsModule];

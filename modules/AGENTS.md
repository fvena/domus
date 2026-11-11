# modules

One folder per area of household life. Empty until phase 1 builds a test module and phase 4 the first real one (lists and shopping). A module enters only after its own grilling review.

A module's parts:

- `contracts/`: its public face, the schemas and actions it offers others. Imports nothing else of the module.
- `server/`: tables, actions and jobs. `server/index.ts` is what `apps/api` registers.
- `web/`: screens. `web/index.ts` is what `apps/web` registers.
- `assistant/`: `SKILL.md`, quick phrases and notices for Kira. Text only (ADR 0016).
- `tests/`.

A module reaches platform only through `@domus/module-sdk`, and other modules only through their `contracts/`. It may also use `utils` and `i18n`; its `web/` adds `ui` and `api-client`, its `tests/` adds `test-utils`. Data and AI libraries arrive through `module-sdk`. Details and reasons: ADR 0017.

The module registry is a fixed list generated at build time; there is no runtime loading or installing.

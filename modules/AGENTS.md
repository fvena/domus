# modules

One folder per area of household life. Phase 1 builds the test module `probe`, phase 4 the first real one (lists and shopping). A module enters only after its own grilling review.

A module's parts:

- `contracts/`: its public face, the schemas and actions it offers others. Imports nothing else of the module.
- `server/`: tables, actions and jobs. `server/index.ts` exports `defineModule(...)`, which `apps/api` registers.
- `web/`: screens. `web/index.ts` is what `apps/web` registers.
- `assistant/`: `SKILL.md`, quick phrases and notices for Kira. Text only (ADR 0016).
- `tests/`.

A module reaches platform only through `@domus/module-sdk`, and other modules only through their `contracts/`. It may also use `utils` and `i18n`; its `web/` adds `ui` and `api-client`, its `tests/` adds `test-utils`. Data and AI libraries arrive through `module-sdk`: Drizzle through `@domus/module-sdk/db`. Details and reasons: ADR 0017.

Data (ADR 0021): the module id is `[a-z][a-z0-9]*`, the same as its folder; `platform` is reserved. Tables come from `moduleTables(id)`, so each carries the id as prefix (`probe_notes`). Foreign keys stay inside the module; hand-written `sql` gets a careful review.

After changing `server/schema.ts`, run `pnpm db:generate`: it writes `server/migrations/` and `server/migrations.ts`. Commit both; never edit an applied migration.

The module list of `apps/api` is written by `pnpm modules:generate` and kept in git; a test fails when it is stale, and CI regenerates both and expects no change. No runtime loading or installing. `testOnly: true` keeps a module out of that list: tests import it and pass it to `test-utils`.

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

Permissions (ADR 0023): a module's own area has its id; it may declare others as `<id>.<name>` in `areas`. Every action declares the permission it asks for, `readAction({ level })` or `writeAction({ undoable, level })`, with an optional `area` (its own by default); start fails on an unregistered area, a write that asks only for `read` or an action without one. Handlers never decide permission: they get only the actor. An area also declares `defaultVisibility`, `publicEditable`, `alwaysPrivate` and `confirmOnSharedDevice`; keep them in `server/areas.ts`, which both `schema.ts` and `defineModule` read.

Visibility (ADR 0023): a table whose records belong to an account comes from `moduleTables(id, areas).ownedTable(name, { type, area }, columns)`, which adds `id` (its only key), `owner` and `visibility`, and a `CHECK` that rejects `public` in an `alwaysPrivate` area. Inserts spread `ownership(table)` from the handler's context. Every query on an owned table puts `visible(table)` in its `where`; the admitted forms are these, and anything else needs review:

- one record, a list, a count or a search: `where(and(<condition>, visible(table)))`;
- an inner join between owned tables of the module: `and(visible(a), visible(b))`, one per table; in a left join each joined table's predicate goes in its `on`.

A record the predicate hides does not exist: the action answers "not found", never "forbidden".

After changing `server/schema.ts`, run `pnpm db:generate`: it writes `server/migrations/` and `server/migrations.ts`. Commit both; never edit an applied migration.

The module list of `apps/api` is written by `pnpm modules:generate` and kept in git; a test fails when it is stale, and CI regenerates both and expects no change. No runtime loading or installing. `testOnly: true` keeps a module out of that list: tests import it and pass it to `test-utils`.

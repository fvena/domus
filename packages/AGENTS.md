# packages

Shared code. Packages never import an app or a module. Each exposes its TypeScript source from `index.ts` (`main`, or `exports` when it has subpaths), extends `@domus/tsconfig/base.json` and has a `type-check` script; only the apps build. A package with tests adds `test` and a `vitest.config.ts`.

- `platform`: the door (`http`: `createHttpHandler`), identity, authorization, audit, jobs and scheduled tasks, events, notifications, storage. The rest is built in phase 1. `@domus/platform/testing` holds a module's raw Drizzle client (`moduleDatabase`); only `test-utils` may import it (ADR 0021).
- `platform/contracts` (`@domus/platform/contracts`): the platform's own contracts, such as `status` and `PROTOCOL`. Pure: no Node, no other part of platform. The only part of platform that `web`, `assistant` and `voice-gateway` may import.
- `module-sdk`: the only part of platform a module may use: `defineModule` and `checkModules`; `@domus/module-sdk/db` re-exports what a module needs of Drizzle and adds `moduleTables(id)` and `id()` (ADR 0021).
- `ui`: the design system, Vue components (phase 2).
- `i18n`: translation runtime and catalogs.
- `utils`: one business-free topic per folder, imported as `@domus/utils/<topic>`. A topic enters when it knows nothing of the business and two places use it; a topic imports another only through a named exception in `.dependency-cruiser.cjs`. Topics: `connection` (connecting, ready, incompatible, with a 10 s limit per check); `program` (port and address reading, the `/health` server, shutdown on signals); `date-time` (`date-fns`, `Intl`) comes in phase 1.
- `test-utils`: what tests use instead of real infrastructure: `createTestPlatform`, a real platform in memory or on a file with the door in process (the only path the rules give the tests of `assistant` and `voice-gateway` to it), and later the fake model and fake channel. Only tests import it.
- `api-client`: `clientFor(contract, transport)`, a thin oRPC link. It holds no contract: callers pass theirs. Authentication and retries belong to the caller.

`utils`, `i18n`, `ui` and `api-client` know nothing of platform, its contracts included.

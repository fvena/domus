# packages

Shared code. Packages never import an app or a module. Each exposes its TypeScript source from `index.ts` (`main`, or `exports` when it has subpaths), extends `@domus/tsconfig/base.json` and has a `type-check` script; only the apps build. A package with tests adds `test` and a `vitest.config.ts`.

Each part's routes, functions, test helpers and ADRs are in [`docs/agents/packages.md`](../docs/agents/packages.md). Read a part's entry before changing that part or testing against it, and update the entry in the same commit.

- `platform`: identity, authorization, actions and the action log, background jobs and tasks, backups and restoring, files, the live channel and notices, and the door in `http`. Permission, confirmation and visibility are decided only in `platform/authorization` (ADR 0010). module-sdk exposes only `ctx.files` and `ctx.notify` of it, and dependency rules keep modules out of the rest. `@domus/platform/testing` holds what only `test-utils` may import, issuing mandates included.
- `platform/contracts` (`@domus/platform/contracts`): pure, with no Node and no other part of platform: the platform's own contracts, `PROTOCOL`, and the headers and name of the connected apps. The only part of platform that `web`, `assistant` and `voice-gateway` may import.
- `module-sdk`: the only part of platform a module may use: `defineModule`, `@domus/module-sdk/db` and `@domus/module-sdk/contracts`. How a module uses them: `modules/AGENTS.md`.
- `ui`: the design system, Vue components (phase 2).
- `i18n`: translation runtime and catalogs.
- `utils`: one business-free topic per folder, imported as `@domus/utils/<topic>`. A topic enters when it knows nothing of the business and two places use it; a topic imports another only through a named exception in `.dependency-cruiser.cjs`.
- `test-utils`: `createTestPlatform`, a real platform with the door in process and a controllable clock, the only path the rules give the tests of `assistant` and `voice-gateway` to it. Only tests import it; its tests run the real restic.
- `api-client`: `clientFor(contract, transport)`, a thin oRPC link. It holds no contract: callers pass theirs. A write's idempotency key and a sensitive operation's step-up proof go in the call's context and travel as headers; authentication and retries belong to the caller.

`utils`, `i18n`, `ui` and `api-client` know nothing of platform, its contracts included.

# Domus

Private family organizer for one two-adult household in Spain, self-hosted on a Raspberry Pi 5, with Kira (the voice and text assistant) inside. Built for this family only.

Read `docs/architecture/README.md` before changing structure, permissions or how programs talk; each decision has its ADR in `docs/architecture/adr/`. Use the terms of `GLOSSARY.md`, and add a term there when a new one settles.

## Phase

The project is built in phases (`docs/architecture/README.md` §6). Phase 0 (the empty skeleton) is built; running it on the Pi is still pending. Build only what the current phase asks for: each feature enters after its own grilling review.

## Setup and commands

Node 22 (`.nvmrc`) with corepack, which installs the pnpm `packageManager` names. Copy `.env.local.example` to `.env.local`; the root scripts load it through dotenv-cli. `pnpm install` turns on the pre-commit hook (`.githooks/pre-commit`: secret scan with gitleaks, lint, format, types); if it is off, run `pnpm run prepare`. The repository is public: the secret scan needs `gitleaks` (`brew install gitleaks`) or Docker running, and blocks the commit otherwise.

| Command                             | Purpose                                      |
| ----------------------------------- | -------------------------------------------- |
| `pnpm install`                      | Install; packages younger than one day wait  |
| `pnpm dev`                          | Every program in watch mode (web on Vite)    |
| `pnpm build`                        | Build the apps                               |
| `pnpm lint` / `pnpm lint:fix`       | Oxlint with types, then the dependency rules |
| `pnpm format` / `pnpm format:check` | Write / check Oxfmt formatting               |
| `pnpm type-check`                   | tsc (tsgo) and vue-tsc in every package      |
| `pnpm test`                         | Vitest in every package that has tests       |
| `docker compose up -d --build`      | The three containers as on the Pi            |

Required gates:

1. After every meaningful change, run `pnpm format` and `pnpm lint`.
2. Before every commit, run `pnpm type-check`.
3. Run the tests before considering a change complete.

## Where a new feature goes

Climb the ladder only as far as the feature needs:

1. Data or behaviour of an existing area: inside that module (an action, a table, a screen).
2. Something other modules need from it: that module's `contracts/`.
3. A new area of household life: a new module in `modules/`, after its review.
4. Business-free code used in two or more places: a topic in `packages/utils/`.
5. Something every module needs (identity, authorization, jobs, events, storage): `packages/platform/`, offered to modules through `module-sdk`.
6. What Kira should know about a module: text in the module's `assistant/` folder; Kira acts only through actions on the API.

Apps only wire programs together; business logic lands in a module or in platform.

## Rules

- Code in English; docs and text the family sees in Spanish. The full language rule and the other review-time standards: `CODING_STANDARDS.md`.
- Layering is enforced by `.dependency-cruiser.cjs` and proved by `tooling/scripts/architecture.test.ts`. Fix the import; a rule changes only with an ADR.
- Permission, confirmation and visibility are decided only in `platform/authorization` (ADR 0010).
- Secrets live outside the repository; runtime data lives in the `api` data volume.
- One `AGENTS.md` per large folder, each with a `CLAUDE.md` that holds `@AGENTS.md`. Size caps: 80 lines here, 40 in a folder (`tooling/scripts/agents-md.test.ts`).

## Agent skills

### Issue tracker

Issues and specs live as local markdown files under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default triage roles, each label equal to its name, as a `Status:` line. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` at the root and ADRs in `docs/architecture/adr/`. See `docs/agents/domain.md`.

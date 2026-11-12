# Coding standards

Read during review. Mechanical rules live in tooling and are not repeated here: oxlint and oxfmt, the dependency rules (`.dependency-cruiser.cjs`) the repository checks in `tooling/scripts` (ADR index and links, AGENTS.md caps, no references to code from before the project), and gitleaks for secrets (pre-commit hook and CI). This file holds the judgement calls.

## Language

- English: code, identifiers, commit messages, and log or error messages meant for whoever operates the system.
- Spanish: text the family sees (screens, Kira's replies, notifications), `docs/` and `GLOSSARY.md`.
- English: instructions for agents (`AGENTS.md`, `docs/agents/`).
- Name domain concepts with the terms of `GLOSSARY.md`, in code with the name the glossary gives.

## Decisions

- Code that contradicts an ADR is a finding, unless a later ADR refines it.
- A new abstraction (a factory, a layer, a configuration system) answers a concrete problem the change has today, with a test that shows it. Otherwise it is Speculative Generality.

## Data

- Hand-written SQL through `sql` gets a careful read: the module's types do not cover it. It touches only its own module's tables (their prefix), never another module's or `platform_` ones (ADR 0021).

## Accepted duplication

The dependency rules force these; they are not findings while they stay this small:

- `checkApi` and the connection wiring in `apps/assistant` and `apps/voice-gateway`: apps cannot import each other, and `utils` cannot import `platform/contracts`.
- The `/api/rpc` prefix in `platform/http` and `api-client`: `api-client` may not import `platform`; `platform/http/http.test.ts` pins both together.

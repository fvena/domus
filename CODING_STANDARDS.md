# Coding standards

Read during review. Mechanical rules live in tooling and are not repeated here: oxlint and oxfmt, the dependency rules (`.dependency-cruiser.cjs`) and the repository checks in `tooling/scripts` (ADR index and links, AGENTS.md caps, no references to code from before the project). This file holds the judgement calls.

## Language

- English: code, identifiers, commit messages, and log or error messages meant for whoever operates the system.
- Spanish: text the family sees (screens, Kira's replies, notifications), `docs/` and `GLOSSARY.md`.
- English: instructions for agents (`AGENTS.md`, `docs/agents/`).
- Name domain concepts with the terms of `GLOSSARY.md`, in code with the name the glossary gives.

## Decisions

- Code that contradicts an ADR is a finding, unless a later ADR refines it.
- A new abstraction (a factory, a layer, a configuration system) answers a concrete problem the change has today, with a test that shows it. Otherwise it is Speculative Generality.

## Accepted duplication

The dependency rules force these; they are not findings while they stay this small:

- `checkApi` and the connection wiring in `apps/assistant` and `apps/voice-gateway`: apps cannot import each other, and `utils` cannot import `platform/contracts`.
- The `/api/rpc` prefix in `platform/http` and `api-client`: `api-client` may not import `platform`; `platform/http/http.test.ts` pins both together.
- `createTestHttpHandler` only forwards to `createHttpHandler` until the in-memory platform exists (phase 1): it is the only path the rules give the tests of `assistant` and `voice-gateway` to the door.
- `createHttpHandler()` takes no parameters until platform and the modules exist (phase 1a).

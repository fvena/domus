# Coding standards

Read during review. Mechanical rules live in tooling and are not repeated here: oxlint and oxfmt, the dependency rules (`.dependency-cruiser.cjs`) the repository checks in `tooling/scripts` (ADR index and links, AGENTS.md caps, no references to code from before the project), and gitleaks for secrets (pre-commit hook and CI). This file holds the judgement calls.

## Language

- English: code, identifiers, commit messages, and log or error messages meant for whoever operates the system.
- Spanish: text the family sees (screens, Kira's replies, notifications), `docs/` and `GLOSSARY.md`.
- English: instructions for agents (`AGENTS.md`, `docs/agents/`).
- Name domain concepts with the terms of `GLOSSARY.md`, in code with the name the glossary gives.

## Decisions

- Code that contradicts an ADR is a finding, unless a later ADR refines it.
- A spec line that contradicts an ADR, the code, or a decision recorded in a ticket's Comments is a finding: the spec changes in the same commit as the decision.
- A new abstraction (a factory, a layer, a configuration system) answers a concrete problem the change has today, with a test that shows it. Otherwise it is Speculative Generality.

## Tests

- A guarantee that a spec or an ADR promises (ids never reused, migrations all or nothing, nothing new published) has a test that tries to break it at its narrowest grain: one statement, one migration, one request. A test that reaches the guarantee only across a wider boundary leaves the narrow case open, and that gap is a finding.
- An undoable write has a test where a later write of what it touched makes its undo answer `changed-since`.
- A record that passes through states (pending, running, retrying, stuck) is checked mid-way, not only once it ends: what a reader sees while it runs is part of its contract.
- A variant the spec admits (a schema that transforms, an absent `via`, an error with data) is exercised by at least one test, even when the module under test does not need it. A guarantee carried by a type (it must reject something) has a `@ts-expect-error` test: a library's types can accept more than they read.

## Security

Read every path that authorizes, confirms, proves or reveals with these three in mind:

- **Existence oracle.** A caller who may not see a record gets the same answer for a hidden record as for a missing one: the same code, the same data, and the same order of checks, so no earlier check (a proof, a permission) answers differently first. The one admitted exception is the referential block of ADR 0024.
- **Check-then-act.** Whatever is verified outside the transaction that uses it, or before an `await` (a password hash, a session, a proof), is verified again inside that transaction.
- **Every path authorizes alike.** A repeat, a confirmation and an undo authorize as the first call does, proof included; a confirmation counts only as the confirmation that was missing. A pending is reused only where it can be answered (same session and conversation).

## Documents

- A changed page of `docs/guia/` comes with a review by the `humanizer` skill, as `docs/AGENTS.md` asks.

## Data

- Hand-written SQL through `sql` gets a careful read: the module's types do not cover it. It touches only its own module's tables (their prefix), never another module's or `platform_` ones (ADR 0021).

## Accepted duplication

The dependency rules force these; they are not findings while they stay this small:

- `checkApi` and the connection wiring in `apps/assistant` and `apps/voice-gateway`: apps cannot import each other, and `utils` cannot import `platform/contracts`.
- The `/api/rpc` prefix in `platform/http` and `api-client`: `api-client` may not import `platform`; `platform/http/http.test.ts` pins both together. The `idempotency-key` header is the same case, pinned by `api-client.test.ts` and the HTTP tests of `probe`.

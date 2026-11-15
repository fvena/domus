---
title: "A step-up proof counts only through the app channel, so Kira cannot reuse one the person asked for"
author: Francisco
date: 2026-11-15
branch: feat/fase-1e
cost: { minutes: 52, tokens: 297518 }
id: l-8f92d2ac
scope: repo
status: active
src: agent
touches:
  - ".scratch/fase-1e/issues/01-llaves-y-el-comando-keys.md"
  - ".scratch/fase-1e/issues/02-la-llave-en-la-puerta-y-en-status.md"
  - ".scratch/fase-1e/issues/04-cuando-muere-un-mandato-limpieza-y-restaurar.md"
  - ".scratch/fase-1e/issues/05-operaciones-de-la-plataforma-y-superficies-cerradas.md"
  - ".scratch/fase-1e/spec.md"
  - GLOSSARY.md
  - apps/AGENTS.md
  - apps/assistant/src/api.ts
  - docs/architecture/README.md
  - docs/architecture/adr/0004-una-sola-puerta.md
---

## Decided
A step-up proof counts only when the operation reaches authorization through the channel `app`. A proof is bound to account, session, device and fingerprint, not to `via`, and a mandate keeps the session it was issued from: so a proof the person asked for in the app was also good for Kira with a mandate of that same session, and a `manage` action went through. Closing `proofs/request` to mandates was not enough.

## Tried and ruled out
- Only counting a proof when `confirmed` is true: the idempotent repeat path also authorizes with `confirmed: true`.
- Rejecting the proof header at the door: permission is decided only in `platform/authorization` (ADR 0010).
- Denying `manage` via Kira outright: it would break the person confirming from the app, with their proof, a pending one born of Kira. That confirmation runs with the origin's `via` but the channel of now, `app`, so the channel rule keeps it.

## Watch out
Any new way a context reaches authorization with a proof must carry its real channel; `contexto` never satisfies a proof.

In the code: `decide` in packages/platform/authorization/index.ts (step 3); tests in authorization.test.ts and modules/probe/tests/mandates-http.test.ts.

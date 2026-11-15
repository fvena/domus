---
title: "Kira acts on someone's behalf only with a mandate the door issues, and never confirms on its own"
author: Francisco
date: 2026-11-14
branch: docs/fase-1e
cost: { minutes: 27, tokens: 185971 }
id: l-f2e11562
scope: repo
status: active
src: agent
touches:
  - GLOSSARY.md
  - docs/architecture/README.md
  - docs/architecture/adr/0004-una-sola-puerta.md
  - docs/architecture/adr/0020-composicion-de-la-api-y-comunicacion-entre-procesos.md
  - docs/architecture/adr/0023-identidad-y-autorizacion.md
  - docs/architecture/adr/0028-archivos.md
  - docs/architecture/adr/0029-eventos-en-directo-y-avisos.md
  - docs/architecture/adr/0030-llaves-y-mandatos.md
  - docs/plan.md
  - packages/platform/authorization/index.ts
---

## Decided
The key only says which app is calling. On whose behalf comes from a mandate the door issues from an interaction it authenticated: stored in the database, for a single app, valid only while its session lives. The door, not Kira, recognizes the voice "yes", in the next turn and only in what the person wrote or said. Phase 1e builds no way to issue mandates in production; phase 5a does.

## Tried and ruled out
- Kira declaring the account in a header: the key would become a credential to act as anyone within their delegation.
- A signed token with nothing stored: a mandate has to die with its session on the next request, so the database is read on every use anyway, and the token would add another secret to guard.
- Letting `confirmations/confirm` accept a mandate: a model mistake, or an instruction slipped into a forwarded email, would confirm on the person's behalf.
- A confidence score in the mandate, a permission ceiling per app, an authentication mode per action, and logging denials in the action log: either they duplicate the delegation table (an area without a row is already "no") or they are features 1e does not need.

## Watch out
No test of 1e may require a production path that issues mandates. Synthetic mandates live only in `@domus/platform/testing`. Rotating the key needs the container recreated, not just restarted, and keeps the old key until the new one works.

In the code: docs/architecture/adr/0030-llaves-y-mandatos.md; the dependency rule production-never-reaches-platform-testing in .dependency-cruiser.cjs; the delegation fallback "an area without a row denies" in packages/platform/authorization/index.ts.

---
title: "An architecture review found that most of the core's complexity pays for chosen guarantees, and ruled out three tempting simplifications"
author: Francisco
date: 2026-11-15
branch: docs/fase-1f
cost: { minutes: 32, tokens: 173184 }
id: l-6e40daab
scope: repo
status: active
src: agent
touches:
  - GLOSSARY.md
  - docs/architecture/README.md
  - docs/architecture/adr/0003-procesos-y-contenedores.md
  - docs/architecture/adr/0020-composicion-de-la-api-y-comunicacion-entre-procesos.md
  - docs/architecture/adr/0023-identidad-y-autorizacion.md
  - docs/architecture/adr/0030-llaves-y-mandatos.md
  - docs/architecture/adr/0031-domus-con-un-agente-opcional.md
  - docs/architecture/adr/0032-autorizacion-del-agente.md
  - docs/architecture/adr/0034-retirar-las-apps-conectadas-antes-de-la-fase-5.md
  - docs/plan.md
---

## Decided
Reviewing whether the architecture is too complex for the house, two independent reviews agreed: most of the core's weight pays for guarantees the family chose (undo, idempotency, privacy between the two adults, AI delegation, crash-safe backups). Removing it would remove functionality. The only thing that could go with no loss was the connected-app mechanism, and it goes in phase 1f (ADR 0034). The next candidates are: reads of owned tables that apply visibility on their own, and making a write's HTTP response match the type the client promises. Both should be settled before the pilot module (phase 4), because it becomes the template for every module.

## Tried and ruled out
- Making the step-up proof sequence the same for reads and writes. The difference is on purpose: a read uses its proof only after its result validates, so a failed read leaves the proof unused. A write uses it before it runs and links it to its log entry inside the transaction.
- Replacing the file upload reservations with a plain free-space check. The reservations subtract the bytes that other uploads in progress have already claimed, and they tell which leftover temporary files belong to an abandoned upload.
- Turning restore's cleanup of the copy into a hooks system. Restore already calls one function per area, in an explicit order, and that order is useful. The real friction is the daily cleanup, which holds the SQL of eight other areas' tables. The fix is to move each statement to its own area, without adding a hooks mechanism.
- Dropping content addressing in files is at most speculative: undo and backups still have to keep detached contents, whatever the file names are.

## Watch out
Reports from sub-agent reviews overstated two of these points. Check each claim in the code before it goes into a recommendation.

In the code: packages/platform/actions/proving.ts and actions/index.ts (answerRead), packages/platform/files/reservations.ts, packages/platform/backups/restore.ts (sanitizeCopy), packages/platform/background/cleanup.ts.

---
title: "A test that starts a child process needs its own timeout, because on CI the child's cold start passes vitest's 5 s default"
author: Francisco
date: 2026-11-15
branch: docs/agente-opcional
cost: { minutes: 3, tokens: 32885 }
id: l-5f676f18
scope: repo
status: active
src: agent
touches:
  - docs/plan.md
  - ".scratch/kira-independiente/borrador/0031-domus-con-un-agente-opcional.md"
  - ".scratch/kira-independiente/borrador/0032-autorizacion-del-agente.md"
  - ".scratch/kira-independiente/borrador/0033-conversacion-alojada-y-voz.md"
  - ".scratch/kira-independiente/borrador/cambios.md"
  - ".scratch/kira-independiente/research.md"
  - GLOSSARY.md
  - docs/architecture/README.md
  - docs/architecture/adr/0001-domus-con-kira-dentro.md
  - docs/architecture/adr/0003-procesos-y-contenedores.md
---

## Decided
Every test that forks a child process with startChild gives itself an explicit timeout (30 s here), as the restore tests already do with RESTIC_TIMEOUT.

## Watch out
Locally the test takes about 0.5 s, so nothing warns you. On CI the child loads tsx, the platform and the module from cold while the heavy test files run at the same time, and it went past 5 s on two runs in a row of a docs-only PR. The failure looks like a broken test, not like load.

In the code: modules/probe/tests/notices.test.ts, CHILD_TIMEOUT on "after the process died once its deliveries were committed recovers it without a second batch"; startChild in packages/platform/testing/children.ts.

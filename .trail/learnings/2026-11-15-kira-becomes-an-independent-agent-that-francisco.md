---
title: "Kira becomes an independent agent that Domus trusts only through its own authorization, never through what the agent says"
author: Francisco
date: 2026-11-15
branch: docs/agente-opcional
cost: { minutes: 54, tokens: 324820 }
id: l-2d456112
scope: repo
status: active
src: agent
touches:
  - ".scratch/kira-independiente/borrador/0031-domus-con-un-agente-opcional.md"
  - ".scratch/kira-independiente/borrador/0032-autorizacion-del-agente.md"
  - ".scratch/kira-independiente/borrador/0033-conversacion-alojada-y-voz.md"
  - ".scratch/kira-independiente/borrador/cambios.md"
  - ".scratch/kira-independiente/research.md"
  - GLOSSARY.md
  - docs/architecture/README.md
  - docs/architecture/adr/0001-domus-con-kira-dentro.md
  - docs/architecture/adr/0003-procesos-y-contenedores.md
  - docs/architecture/adr/0004-una-sola-puerta.md
---

## Decided
Kira leaves the repository in phase 5. Domus admits one optional connected agent, which uses Domus over MCP on behalf of each person and can be hosted in Domus's chat and voice. Domus keeps the final word on access, visibility, execution and confirmation. A "yes" that reaches Domus through the agent never confirms anything: confirmation happens in Domus's own dialog or app.

## Tried and ruled out
- Giving Kira its own user account: one account sees either all private data or none, and the audit loses "Paco via Kira".
- Tying the per-person agent link to a browser session: closing Domus in the browser would cut Kira on Telegram. Immediate revocation comes from checking the link in the database on every request, not from the session.
- Trusting only the signature of the agent's access tokens: Better Auth issues JWTs whenever a resource is named, which MCP always does, so a revoked origin would keep working until expiry.
- Resetting delegation to the current default when the agent changes: that default copies read and write without confirmations, so it would open more than the old agent had. Delegation is born fully denied instead.
- Running an agent-provided wake-word script inside Domus's page: it could read everything the session sees. Domus runs the detector and the agent provides only the model.
- Executing a confirmed read at confirmation time: the result would stay on Domus's screen and never reach the agent. The read is approved and the agent runs it once.

## Watch out
- Until phase 5, keys and mandates from phase 1e are still the rule. The new ADRs say "a partir de la fase 5" on purpose; don't write "sustituido" yet.
- Domus cannot stop Kira from saying private data aloud on a shared speaker, even data it confirmed. That control is a written requirement of Kira's own plan.
- Better Auth's docs disagree on refreshTokenReuseInterval (0 in the OAuth Provider, 30 s under mcp()). Check it against the installed version.

In the code: docs/architecture/adr/0031-domus-con-un-agente-opcional.md, 0032-autorizacion-del-agente.md, 0033-conversacion-alojada-y-voz.md; docs/plan.md "Trasladado al plan de Kira"; research in .scratch/kira-independiente/research.md.

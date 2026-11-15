---
title: "Most of the core's complexity pays for guarantees the family chose, and three tempting simplifications were ruled out"
author: Francisco
date: 2026-11-15
branch: docs/fase-1f
cost: { minutes: 1, tokens: 1503 }
id: l-6d0776f6
scope: repo
status: active
replaces: l-6e40daab
src: agent
---

## Decided
The weight of the core pays for guarantees the family chose: undo, idempotency, privacy between the two adults, AI delegation and crash-safe backups. Cutting it would cut functionality. Only the connected-app mechanism could go at no loss (ADR 0034). Three candidates were left as open opportunities, not decisions: reads of owned tables that apply visibility on their own; a write's HTTP response that matches the client's type; and moving each area's cleanup SQL next to its area.

## Tried and ruled out
- One proof sequence for reads and writes. A read uses its proof only after its result validates; a write uses it before it runs and links it to its entry. The difference is on purpose.
- A plain free-space check instead of upload reservations. The reservations count the bytes other uploads in progress have already claimed, and they mark which temporary files an abandoned upload left behind.
- A hooks system for restore. Restore already calls one function per area, in an explicit order that matters.

## Watch out
Sub-agent review reports overstated two of these points. Check each claim in the code before it becomes a recommendation.

In the code: platform/actions/proving.ts, actions/index.ts (answerRead), files/reservations.ts, backups/restore.ts (sanitizeCopy), background/cleanup.ts.

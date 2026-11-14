---
title: "A write's invalidations wait in a temporary table of its transaction, not in a list in memory"
author: Francisco
date: 2026-11-14
branch: feat/fase-1d4-02-canal-en-directo
cost: { minutes: 4, tokens: 32257 }
id: l-9d5e6cd1
scope: repo
status: active
src: agent
touches:
  - ".scratch/fase-1d4/issues/03-la-bandeja-de-salida.md"
  - ".scratch/fase-1d4/issues/01-ajustes-previos.md"
  - ".scratch/fase-1d4/spec.md"
  - modules/probe/tests/outbox.test.ts
  - packages/AGENTS.md
  - packages/platform/actions/index.ts
  - packages/platform/background/cleanup.test.ts
  - packages/platform/background/engine.ts
  - packages/platform/background/index.ts
  - packages/platform/generated-migrations.ts
---

## Decided
- A write leaves the records it changed (`changesOf` of the capture) in a TEMP table of the connection, inside its own transaction; the sharing out reads what committed once no transaction is open (a `queueMicrotask`, and again before each heartbeat and before opening a channel). A rollback, of the whole write or of a savepoint, drops the rows with it, so a rolled-back write never invalidates. better-sqlite3 has no commit hook, and its transactions are synchronous, so no microtask runs while one is open.
- The heartbeat drains first, so a beat never overtakes a write committed before it: tests use the heartbeat as the "nothing else arrived" sentinel.
## Tried and ruled out
- A list in memory checked against the action log entry number: a rolled-back entry's number can be reused by the next write in the same tick, so its changes would go out under the wrong write.
## Watch out
- Iterate a copy of the channel list when ending channels while sharing: ending one unregisters it, and mutating the array mid-`filter` skipped the next channel.
- Better Auth sets session expiry from real time: two browsers signed in a few ms apart expire a few ms apart. Expire the one signed in first and keep the other alive.

In the code: `packages/platform/events/index.ts` (`remember`, `share`), `packages/platform/actions/capture.ts` (`changesOf`), `modules/probe/tests/events.test.ts`.

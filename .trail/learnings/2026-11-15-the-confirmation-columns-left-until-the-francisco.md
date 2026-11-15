---
title: The confirmation columns left until the migration of phase 1f
author: Francisco
date: 2026-11-15
branch: feat/fase-1f-04-contexto-y-voice
cost: { minutes: 14, tokens: 52925 }
id: l-1407e892
scope: repo
status: active
src: agent
touches:
  - packages/platform/actions/confirmations.ts
  - packages/platform/actions/answering.ts
  - packages/platform/authorization/index.ts
---

## Decided
Since phase 1f ticket 04, nothing confirms in context: confirm-in-context left DECISIONS in packages/platform/authorization/index.ts, and the shared device rule only denies a read of a confirmOnSharedDevice area when the represented account's role is device (it no longer reads deviceAccount). platform_confirmations still has window_closes_at (NOT NULL, no default) and context_only until the migration of ticket 05, so create in actions/confirmations.ts writes window_closes_at with the same value as expires_at and context_only as 0, and reachable in actions/answering.ts answers NOT_FOUND to a row with context_only = 1, which only a database from before 1f can hold.

## Tried and ruled out
- Leaving window_closes_at out of the INSERT: the column takes no null and has no default, so every new pending confirmation would fail until the migration.
- Treating an old context_only row as an ordinary one confirmable from the app: the spec keeps it unanswerable, and the migration deletes those rows before dropping the columns.

## Watch out
Ticket 05 must drop both columns, the contextOnly field of PendingConfirmation, its check in reachable, and the UPDATE-prepared test in packages/platform/actions/confirmations.test.ts, which then has no column to set. A pending read is now reused only from the same session (findRead/sameOrigin); without a session two reads never share one.

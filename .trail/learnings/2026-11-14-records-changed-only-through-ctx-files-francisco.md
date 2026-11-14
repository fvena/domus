---
title: "Records changed only through ctx.files invalidate, and the stale sign-in cleanup"
author: Francisco
date: 2026-11-14
branch: feat/fase-1d4-revision-2
cost: { minutes: 54, tokens: 129280 }
id: l-77a3b441
scope: repo
status: active
src: agent
touches:
  - packages/platform/files/references.ts
  - packages/platform/actions/capture.ts
  - packages/platform/notifications/index.ts
  - packages/platform/identity/passwords.ts
---

## Watch out
- ctx.files attach, detach and reattach change rows of platform_file_references, not the owner record's row, so the write capture never sees them: touched alone does not invalidate. Each change also pushes an OwnedRecordChange into WriteRun.changed, with the record's owner and visibility read then as both before and after; changesOf(transitions, run.changed) adds them after the captured ones, keyed by module, type and id, so a record whose row also changed (delete with detach, restore with reattach) goes out once with its captured states.
- The cleanup in session.create.after runs when the creation ends, which can be after a later sign-in on the same device wrote its entry and subscribed (the first held at entering). Deleting every subscription of another session then removed the enabled one: removeOthers now also requires NOT sessionEnabledWhere of the subscription's session.
- A check made before an await must be redone inside the transaction with the clock read there: replacePassword takes the clock, not an instant, because the hash runs between.

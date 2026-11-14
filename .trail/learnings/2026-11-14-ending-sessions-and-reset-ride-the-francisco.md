---
title: "Ending sessions and reset ride the channel's pending table"
author: Francisco
date: 2026-11-14
branch: feat/fase-1d4-08-fin-de-sesion
cost: { minutes: 28, tokens: 92109 }
id: l-e226051f
scope: repo
status: active
src: agent
touches:
  - "packages/platform/identity/sessions.ts#endSessions"
  - packages/platform/events/index.ts
  - packages/platform/identity/auth.ts
---

## Decided
- Ending sessions and permissions/set do not call the channels directly: events.sessionsEnded and events.accessChanged insert a row into the same TEMP table (platform_invalidations) that a write's changes use, inside the transaction that ends the sessions or changes the grant. So a rollback drops the purge or reset with it, and share() sends them in commit order, never ahead of a write committed before. Every in-api deletion of platform_session goes through endSessions in identity/sessions.ts (DELETE ... RETURNING id) with its reason.
- Signing out is deleted by Better Auth itself; 1.7.20 has databaseHooks.session.delete.after (run after the delete, queued after any transaction), which createAuth turns into ended([id], 'sign-out'). It also fires when Better Auth deletes a session it found expired; purge there is right.
## Watch out
- Platform operations have no handler a test can wrap, so to roll back revokeSession after its session row went, session-end.test.ts creates a TEMP trigger on platform_action_log that RAISE(ABORT)s, through probe's raw client (test.dbFor(probe).run(sql.raw(...))), and drops it after. A trigger on platform_session itself would abort the DELETE before endSessions tells anyone, so it would not test the rollback.
- share() first ends every listed channel whose session no longer lives, so an ended session's channel gets purge before earlier invalidations still in the table: harmless, purge supersedes them.

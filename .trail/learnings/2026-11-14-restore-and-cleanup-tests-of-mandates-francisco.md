---
title: Restore and cleanup tests of mandates need a mandate life longer than the clock jump
author: Francisco
date: 2026-11-14
branch: feat/fase-1e-04-muerte-y-restaurar
cost: { minutes: 1, tokens: 8849 }
id: l-bb196904
scope: repo
status: active
src: agent
touches:
  - ".scratch/fase-1e/issues/03-kira-llama-a-acciones-con-un-mandato.md"
  - ".scratch/fase-1e/spec.md"
  - modules/probe/tests/mandates-http.test.ts
  - packages/AGENTS.md
  - packages/platform/generated-migrations.ts
  - packages/platform/http/http.test.ts
  - packages/platform/http/index.ts
  - packages/platform/identity/mandates.test.ts
  - packages/platform/identity/mandates.ts
  - packages/platform/identity/sessions.ts
---

## Decided
- A test that takes a backup moves the platform clock to 05:00 of the first day (FIRST_BACKUP), hours after TEST_START, so a mandate issued before the copy has already expired by its default 15 minutes when the test checks it after restoring: it would answer UNAUTHORIZED for the wrong reason. modules/probe/tests/restore-keys.test.ts opens its platforms with mandateLife of a day, so a mandate of the copy would still be good at the instant of restoring but for the restore itself.
- Restoring revokes only the live keys of the copy at the restore instant (revokeEveryKey in identity/keys.ts, WHERE revoked_at IS NULL); one revoked before keeps its own instant, as keys revoke does with one already revoked.
- The cleanup's step for platform_mandates uses the same rules as resolving one (expires_at <= now, sessionLivesWhere), with no index: the table holds minutes of mandates.

## Watch out
- revokeDevice only takes a session of the device account (its device), so to end a person's session by revoking the device, sign the device account in, copy its device cookie (domus.device) to another browser and sign the person in there; pass the device account's session to the operation (see mandate-end.test.ts).
- The mandates deleted on restore are not observable from outside: every session already ended, so no mandate resolves either way.

In the code: packages/platform/backups/restore.ts (sanitizeCopy), packages/platform/background/cleanup.ts, packages/platform/identity/mandates.ts (endEveryMandate).

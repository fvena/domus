---
title: A woken clock jump of months runs the cleanup
author: Francisco
date: 2026-11-14
branch: feat/fase-1d4-05-repartir-y-enviar
cost: { minutes: 95, tokens: 464124 }
id: l-6adec54e
scope: repo
status: active
src: agent
touches:
  - packages/platform/background/cleanup.ts
  - "packages/platform/schema.ts#deliveries"
---

## Watch out
Moving the test clock to a browser session's expiry (months after TEST_START, since Better Auth sets it from the real time) with the default wake runs the daily cleanup, which deletes jobs finished more than 30 days before. A notice's job is then purged while its delivery is still held at the interleave point delivering, and the ON DELETE CASCADE of platform_deliveries takes the delivery's row with it, so the delivery fails with 'has no row' instead of ending session-ended. The notices test moves the clock with { wake: false } and waits with background.settled() instead of runDue(), which would wake the scheduler and race the cleanup against the delivery.

## Decided
Both foreign keys of platform_deliveries to platform_jobs cascade on delete, because the cleanup deletes finished jobs and would otherwise fail on the delivery rows; in production a delivery ends within its 24 h deadline, long before its notice is 30 days old.

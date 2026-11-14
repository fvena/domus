---
title: Every sign-in passes interleave at entering
author: Francisco
date: 2026-11-14
branch: feat/fase-1d4-04-suscripciones
cost: { minutes: 12, tokens: 39239 }
id: l-edfd4218
scope: repo
status: active
src: agent
touches:
  - packages/platform/identity/auth.ts
  - packages/test-utils/uploads.test.ts
  - modules/probe/tests/subscriptions.test.ts
---

## Watch out
Since phase 1d4 ticket 04, every sign-in through Better Auth calls the test's interleave with the point `entering` (session.create.before in packages/platform/identity/auth.ts, after writing the device's entry). A test that passes an interleave without checking the point holds or fails its own sign-ins too, because the same function serves every point: two upload tests in packages/test-utils/uploads.test.ts hung or failed with 500 until they returned early for other points. Throwing or rejecting at `entering` fails the sign-in with the entry already written, which is how the subscription tests leave a device with no enabled session.

## Decided
Two sign-ins at once on one device are tested with two test browsers given the same `domus.device` cookie, holding the first at `entering` while the second ends, because only a shared device cookie puts both sessions on one device; modules/probe/tests/subscriptions.test.ts does it in both orders.

---
title: Deadline of a job across timeouts
author: Francisco
date: 2026-11-14
branch: feat/fase-1d4-06-fallos-del-push
cost: { minutes: 1, tokens: 15986 }
id: l-53d19200
scope: repo
status: active
src: agent
touches:
  - packages/platform/notifications/notices.ts
  - packages/platform/background/engine.ts
---

A job with a deadline of its own (a delivery's, 24 h from its notice) cannot decide its expiry only when it fails: when the lane's maximum time aborts its signal, the engine's handler in background/engine.ts start() checks abort.signal.reason === TIMED_OUT before the error type and retries by the growing wait whatever the job threw, a PermanentJobError included. So the delivery checks the deadline twice: in prepare(), before every send (it catches the retry a timeout set past it, and a first attempt the Pi reaches late), and after a passing answer with JobContext.retryAt(notBefore), the instant the engine would retry at, so a Retry-After or a backoff past the deadline fails DELIVERY_EXPIRED at once instead of waiting. retryAt shares retryInstant() with afterPassingError, so the two never disagree.

---
title: "Testing a session's expiry on the platform clock"
author: Francisco
date: 2026-11-14
branch: feat/fase-1d4-01-ajustes-previos
cost: { minutes: 1, tokens: 10385 }
id: l-db98a364
scope: repo
status: active
src: agent
touches:
  - packages/platform/identity/sessions.ts
  - packages/test-utils/platform.ts
  - modules/probe/tests/files-cleanup.test.ts
---

In tests, Better Auth sets the expiry of a browser() session from the real time (now + 7 days), while the platform checks it against the test clock, which starts at TEST_START (2026-01-01). Faking Date for the sign-in does not work: Better Auth then rejects the session at once against the real time. So a test reads the expiry with test.sessionExpiresAt(session) and moves the platform clock to it; prepare.session sessions expire at the test clock + 7 days, so a test that moves the clock past that with a prepared session sees it ended (the proof cleanup test now uses a sessionless context for that reason). To run the cleanup just past an expiry, move the clock there with { wake: false }, then background.setTime('cleanup', <local HH:MM in Madrid>): a woken jump runs a catch-up planned on that local date, and the scheduler allows one run per task and local date, so a second run that day never happens. Child processes that open the platform need the test clock instant too (hold: 'publish' takes now), else Date.now makes a prepared session look expired.

---
title: Issuing a mandate lives in platform/testing in phase 1e
author: Francisco
date: 2026-11-14
branch: feat/fase-1e-03-mandatos
cost: { minutes: 30, tokens: 144180 }
id: l-d0e0830a
scope: repo
status: active
src: agent
touches:
  - packages/platform/http/index.ts
  - ".dependency-cruiser.cjs"
---

## Decided
issueMandate lives in packages/platform/testing/mandates.ts, not in platform/identity as ticket 03 said: anything exported from identity could be imported by production code without breaking a rule, while in testing the unchanged rule production-never-reaches-platform-testing proves that no production code issues a mandate (ADR 0030). Reading and resolving (readMandate, resolveMandate) stay in identity/mandates.ts. Phase 5a moves issueMandate into identity when the door issues mandates from real interactions.

## Watch out
Only the module actions ask the door for a context with a mandate (verify({ mandate: true })); every other route still gets null with Authorization. Ticket 05 opens log/read and log/undo by passing that option. The session-to-context fields are in one place, originOf of identity/sessions.ts, used by both the door and issueMandate.

## Tried and ruled out
A new dependency rule guarding identity/issue-mandate.ts: the spec says the rules do not change, and the existing one already covers testing/.

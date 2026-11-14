---
title: "Reviewers get only pointers, not the orchestrator's list of suspicions"
author: Francisco
date: 2026-11-14
standing: true
id: l-ef313d62
scope: repo
status: active
src: init-review
touches:
  - docs/agents/workflow.md
---

## Decided
- Both reviews of phase 1d1 were primed with a list of points and missed the real bug. Suspicions are now checked separately, after the review.
- In the code: Follow docs/agents/workflow.md: give review subagents pointers only, and check your own suspicions apart, after the review.

_From PR #18 here, Nov 12._

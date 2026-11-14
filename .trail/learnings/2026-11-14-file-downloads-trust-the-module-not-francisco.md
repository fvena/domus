---
title: "File downloads trust the module, not the record; four review smells kept on purpose"
author: Francisco
date: 2026-11-14
branch: feat/fase-1d3
cost: { minutes: 1, tokens: 2490 }
id: l-545aa6f1
scope: repo
status: active
src: agent
touches:
  - packages/platform/actions/index.ts
  - packages/platform/files/references.ts
  - modules/AGENTS.md
---

## Decided
- A download only checks that the file reference is live and belongs to the same module as the read. It does not check which record of that module owns it. Agreed in the ticket 04 note of phase 1d3; a second review raised it again and it was left as is.
- Writes that only change files through ctx.files count as having touched their owner record: checkOutcome merges what ctx.files touched, so returning touched: [] is fine there. The older rule (empty touched on an undoable write is an internal error) still holds for everything else.
- Kept on purpose after two reviews: extra test-utils exports used by probe tests; no branded types for ids (they travel as text in JSON and SQL); file row steps living in the general background cleanup (they are row batches like the other tables').

## Watch out
- A buggy read could mark a file of another record of the same module with fileRef() and it would be served. Tests of a module's reads are what guard that.

In the code: packages/platform/actions/index.ts (download, openReturned, checkOutcome), packages/platform/files/references.ts (live), .scratch/fase-1d3/issues/04 and 09 for the reasons.

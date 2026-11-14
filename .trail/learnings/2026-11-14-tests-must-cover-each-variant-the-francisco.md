---
title: "Tests must cover each variant the spec allows, because review found bugs there"
author: Francisco
date: 2026-11-14
standing: true
id: l-ecd1b06b
scope: repo
status: active
src: init-review
touches:
  - CODING_STANDARDS.md
---

## Watch out
- Two bugs in phase 1b slipped past code review because no test used a variant the spec admitted: a transforming inverse schema ran twice on undo, and declared errors accepted any data.
- In the code: In CODING_STANDARDS.md Tests: write a test for every variant the spec admits, and a @ts-expect-error test for type guarantees.

_From PR #13 here, Nov 12._

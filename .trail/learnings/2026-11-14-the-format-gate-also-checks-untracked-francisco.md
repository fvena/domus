---
title: "The format gate also checks untracked files, so trail's own files make pnpm check fail"
author: Francisco
date: 2026-11-14
branch: feat/fase-1d3
cost: { minutes: 1, tokens: 18020 }
id: l-c43a8e44
scope: repo
status: active
src: agent
touches:
  - tooling/scripts/check.sh
---

## Watch out
- pnpm check and the pre-commit hook run the formatter over the working tree, untracked files included, and stop at the first failing gate. Any untracked file a tool writes in the repository, unformatted and not ignored, fails the commit before lint, types and tests run.
- Trail writes a long section between its markers in the root AGENTS.md when it is set up, and may write it again: that section breaks the 80-line cap.

## Decided
- The formatter and the linter ignore .trail/ (trail writes it); graft/ and .pnpm-store/ are caches, kept out of git. The trail section of AGENTS.md is one pointer line between trail's markers.

In the code: .oxfmtrc.json and .oxlintrc.json (ignorePatterns), .gitignore, tooling/scripts/check.sh (format:check first), tooling/scripts/agents-md.test.ts (the cap).

---
title: "Claude's git worktrees run the main checkout's pre-commit hook, not the one on their branch"
author: Francisco
date: 2026-11-15
branch: claude/dreamy-jones-39bdf1
cost: { minutes: 2, tokens: 13154 }
id: l-660685db
scope: repo
status: active
src: agent
touches:
  - ".githooks/pre-commit"
  - docs/guia/como-se-construye.md
  - tooling/scripts/gitleaks.ts
  - tooling/scripts/pre-commit.test.ts
  - package.json
---

## Watch out
Worktrees created by Claude Code carry a per-worktree `core.hooksPath` pointing at the main checkout's `.githooks`, with an absolute path. A commit from a worktree therefore runs whatever hook the main checkout has checked out, not the branch's own. A branch that changes the hook is not exercised by its own commits, and a hook fix only reaches worktrees once the main checkout has it. This is why the first worktree commit after the worktree secret-scan fix still failed with the old "not a git repository" error.

To commit from a worktree with the branch's own hook, still the full hook with nothing skipped: `git -c core.hooksPath=.githooks commit ...`. Never `--no-verify`.

In the code: `git config --show-origin --get-all core.hooksPath` shows both entries: `.githooks` in `<main>/.git/config` and the absolute `<main>/.githooks` in `<main>/.git/worktrees/<name>/config.worktree`. The hook itself is `.githooks/pre-commit`, and `package.json` `prepare` sets the relative one.

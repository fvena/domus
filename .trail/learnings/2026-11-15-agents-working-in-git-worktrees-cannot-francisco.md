---
title: "Agents working in git worktrees cannot commit, so their work is committed from the main checkout with the full hook"
author: Francisco
date: 2026-11-15
branch: feat/fase-1f
cost: { minutes: 1, tokens: 1340 }
id: l-b5181e6d
scope: repo
status: active
src: agent
touches:
  - tooling/scripts/gitleaks.ts
---

## Decided
Implementer agents in their own git worktrees leave their work staged and the orchestrator commits it from the main checkout, where `.githooks/pre-commit` runs entirely (secret scan, lint, dependency rules, types). Export the staged diff with `git diff --cached --binary` and apply it with `git apply --index --3way` on the integration branch.

## Tried and ruled out
- Committing with --no-verify: the permission classifier denies it, and rightly so, because the repo is public and the secret scan must run.
- Mounting the main .git into the hook's container from inside a worktree: the worktree isolation refuses it.

## Watch out
The cause is the Docker fallback in `.githooks/pre-commit`, used whenever the gitleaks on PATH is not the pinned version. It mounts only the checkout, and a worktree's .git is a file that points outside it, so gitleaks reports "not a git repository". Tell implementers about it in their brief so they don't spend their run hitting it.

In the code: `.githooks/pre-commit` (the Docker fallback) and `tooling/scripts/gitleaks.ts`; gitleaks 8.24.3 is pinned, and brew installs another version.

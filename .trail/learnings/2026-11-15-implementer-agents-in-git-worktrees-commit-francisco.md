---
title: "Implementer agents in git worktrees commit with the normal hook, never with --no-verify"
author: Francisco
date: 2026-11-15
branch: chore/cierre-fase-1f
cost: { minutes: 42, tokens: 92854 }
id: l-3d1bf783
scope: repo
status: active
replaces: l-b5181e6d
src: agent
touches:
  - AGENTS.md
  - docs/agents/implementer-brief.md
  - ".scratch/fase-1f/issues/06-la-pi-y-el-cierre.md"
  - GLOSSARY.md
  - docs/architecture/README.md
  - docs/despliegue.md
  - docs/guia/README.md
  - docs/guia/acciones.md
  - docs/guia/arquitectura.md
  - docs/guia/la-pi.md
---

## Decided
Implementer agents commit their own ticket from their git worktree, through `.githooks/pre-commit` with its full secret scan. Before the worktree fix, the work was staged and the orchestrator committed it from the main checkout; that detour is no longer needed.

## Tried and ruled out
- Committing with --no-verify: the permission classifier denies it, and rightly so, because the repo is public and the secret scan must run.

## Watch out
Claude's worktrees run the main checkout's hook, not the one on their branch. A change to the hook only reaches worktrees once it is on main and the main checkout has pulled it. If a worktree commit is blocked by the secret scan with "not a git repository", the main checkout's hook predates the fix: pull main there.

In the code: `.githooks/pre-commit` (the Docker fallback mounts the common git folder at `/git`), `tooling/scripts/pre-commit.test.ts`.

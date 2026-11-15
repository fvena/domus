---
title: "The hook's Docker secret scan works from a git worktree by mounting the main .git read-only at a fixed path"
author: Francisco
date: 2026-11-15
branch: claude/dreamy-jones-39bdf1
cost: { minutes: 5, tokens: 85572 }
id: l-cf4ee099
scope: repo
status: active
src: agent
touches:
  - ".githooks/pre-commit"
  - tooling/scripts/pre-commit.test.ts
  - tooling/scripts/gitleaks.ts
---

## Decided
When the checkout's git folder is not `./.git` (a git worktree), the Docker fallback of the pre-commit hook mounts the common git folder (the main repository's .git) read-only at /git and tells git where things are with GIT_DIR=/git/worktrees/<name>, GIT_COMMON_DIR=/git and GIT_WORK_TREE=/repo. The main checkout runs exactly as before. Worktrees can now commit with the full hook; the old workaround of committing their staged diff from the main checkout is no longer needed.

## Tried and ruled out
- Mounting the common git folder at its own host path (`-v /Users/.../.git:/Users/.../.git:ro`) so the `.git` file's absolute pointer resolves: under Docker Desktop on macOS that target shows up empty inside the container, and gitleaks still fails with "not a git repository". The same source mounted at /git is fine.

## Watch out
A failed scan ("not a git repository", "partial scan") exits 1, so it blocks rather than letting a commit through; the tests check the output says "1 commits scanned" so a scan of nothing would not pass as clean.

In the code: `.githooks/pre-commit` (Docker branch), `tooling/scripts/pre-commit.test.ts` (real commits in throwaway repos, main checkout and worktree, through each route available), `tooling/scripts/gitleaks.ts` (isPinnedGitleaks, dockerRuns).

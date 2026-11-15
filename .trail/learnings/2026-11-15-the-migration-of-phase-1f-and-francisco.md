---
title: The migration of phase 1f and the database of phase 1e in tests
author: Francisco
date: 2026-11-15
branch: feat/fase-1f-05-migracion
cost: { minutes: 27, tokens: 62411 }
id: l-f13a9bb6
scope: repo
status: active
replaces: l-1407e892
src: agent
touches:
  - packages/platform/migrations/0017_damp_carlie_cooper.sql
  - tooling/scripts/phase-1e-database.test.ts
  - packages/platform/actions/confirmations.ts
  - packages/platform/actions/answering.ts
---

## Decided
packages/platform/migrations/0017_damp_carlie_cooper.sql drops platform_keys, platform_mandates and the columns window_closes_at and context_only of platform_confirmations; the DELETE of the rows with context_only = 1 is written by hand, with a SQL comment, before the DROP COLUMN statements. drizzle-kit never rewrites a migration it already wrote, so db:generate keeps it and regenerates generated-migrations.ts with its hash: edit the .sql, then run pnpm db:generate twice and check git shows no diff. The confirmations code no longer has contextOnly, and the INSERT writes only expires_at.

The tests of a database from before 1f live in tooling/scripts/phase-1e-database.test.ts, because only tooling may join the platform's migrator (packages/platform/migrator.ts and migrations.ts by relative path) with @domus/probe/server and @domus/test-utils: test-utils never imports a module, and modules' tests may not import platform. The 1e database is written with migrate() up to the tag 0016_complete_tomorrow_man plus probe's migrations and plain INSERTs, then opened with createTestPlatform or backed up with real restic from its folder (restic backup --host domus domus.db, with cwd the folder, which puts it at /domus.db as restore expects).

## Tried and ruled out
- Preparing the old database through createTestPlatform: it always applies the current migrations, and the spec forbids an option to start with migrations halfway.

## Watch out
A later phase that needs a database of phase 1f in a test can copy this file and move the tag to the last migration of 1f.

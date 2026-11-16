---
title: "A night's cleanup and copy on the Pi are checked read-only over ssh, without signing in"
author: Francisco
date: 2026-11-16
branch: chore/cierre-fase-1f
cost: { minutes: 10, tokens: 124723 }
id: l-2123d337
scope: repo
status: active
src: agent
touches:
  - ".scratch/fase-1d3/issues/10-la-pi-y-el-cierre.md"
  - ".scratch/fase-1d4/issues/10-la-pi-y-el-cierre.md"
  - ".scratch/fase-1e/issues/08-la-pi-y-el-cierre.md"
  - ".scratch/fase-1f/issues/06-la-pi-y-el-cierre.md"
  - docs/despliegue.md
  - docs/plan.md
---

## Decided
- To close a subphase that waits for a night's cleanup or copy, the agent checks it alone over `ssh kira`, reading the database read-only, with no session and no password from the person. `tasks/list` would need a signed-in admin, and these checks don't.

## Watch out
- `platform_task_runs` records each run with `planned_date`, `result` and `error`. A cleanup that ran but found nothing still shows `ok`, so check the effect as well: the files on disk and the file tables.

In the code: over `ssh kira`, in `~/domus`: `docker compose exec -T api node -e` with `better-sqlite3` on `/data/domus.db` `{ readonly: true, fileMustExist: true }`, reading `platform_task_runs ORDER BY id DESC` and counting `platform_prepared_files`, `platform_file_contents` and `platform_file_references`; `docker compose exec -T api find /data/files /data/backup-staging -type f`; the restic `snapshots` command from docs/despliegue.md «Listar el repositorio»; `curl -s localhost:3000/health`.

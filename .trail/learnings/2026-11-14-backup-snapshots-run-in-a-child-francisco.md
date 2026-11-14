---
title: Backup snapshots run in a child process because the built-in copy froze the API
author: Francisco
date: 2026-11-14
standing: true
id: l-618718a8
scope: repo
status: active
src: init-review
---

## Tried and ruled out
- With a 500 MB database, finishing the online backup flushed the whole file synchronously in the API's single thread, freezing it for 1.1 to 1.4 seconds on the Pi. The team moved the snapshot to a child process (ADR 0027).
- In the code: In packages/platform/backups, snapshot with a child process that takes the shared lock on domus.lock and runs VACUUM INTO staging/domus.db. Do not call db.backup() inside api.

_From PR #20 here, Nov 13._

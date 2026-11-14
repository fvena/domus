---
title: Undoable writes that record no touched records are an internal error
author: Francisco
date: 2026-11-14
standing: true
id: l-841a9f1a
scope: repo
status: active
src: init-review
---

## Watch out
- In phase 1d1 the tasks' undoable writes logged an empty touched list, so the changed-since check could never fire. Two reviews missed it.
- In the code: In packages/platform/actions (checkOutcome), an undoable write with empty touched is rolled back as an internal error. Tests need a case where a later write makes the undo answer changed-since.

_From PR #18 here, Nov 12._

---
title: Every deployment command a phase adds must be run on the Pi before closing
author: Francisco
date: 2026-11-14
standing: true
id: l-b97f4053
scope: repo
status: active
src: init-review
touches:
  - docs/despliegue.md
---

## Watch out
- The sign-out command in the deployment guide had never been run, and it answered 400 without a body.
- In the code: Before closing a subphase, run each command added to docs/despliegue.md on the Pi (ssh kira). The sign-out example needs -d '{}'.

_From PRs #18, #17 here, Nov 12._

---
title: "Secret scanning in a container must trust the checkout, or it scans nothing"
author: Francisco
date: 2026-11-14
standing: true
id: l-e5b80d7c
scope: repo
status: active
src: init-review
---

## Watch out
- Run as a user who does not own the checkout, git skips the repo and gitleaks reports no leaks after scanning zero commits.
- In the code: When running gitleaks via Docker in .githooks/pre-commit and validate-prs.yml, keep safe.directory=* and check that the commits scanned count is above 0.

_From PR #3 here, Nov 11._

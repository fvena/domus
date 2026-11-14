---
title: "CI must actually start the containers, since building the images hid a startup crash"
author: Francisco
date: 2026-11-14
standing: true
id: l-978bf064
scope: repo
status: active
src: init-review
touches:
  - ".github/workflows/validate-prs.yml"
---

## Watch out
- The api image built fine but crashed at startup (a native module bundled in), and CI stayed green because it only ran docker build.
- In the code: Keep the containers job in .github/workflows/validate-prs.yml: docker compose up --detach --build --wait --wait-timeout 240, logs on failure, down --volumes always.

_From PR #10 here, Nov 12._

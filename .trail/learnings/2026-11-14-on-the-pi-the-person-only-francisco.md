---
title: On the Pi the person only types passwords; the agent runs the rest with the session they leave
author: Francisco
date: 2026-11-14
branch: chore/cierre-fase-1d3
cost: { minutes: 44, tokens: 276540 }
id: l-706be2ed
scope: repo
status: active
src: agent
touches:
  - docs/despliegue.md
  - docker/Dockerfile
  - tooling/scripts/module-list.ts
---

## Decided
- Closing phase 1d3 on the Pi, the person only signed in and asked for a step-up proof, through two throwaway scripts in a 700 folder on the Pi (~/.domus-cierre: entrar.sh <port> <name>, comprobante.sh <port> <name> <operation>). Those scripts kept the cookie and the proof in that folder; the agent ran every other request over ssh with them, then signed out and removed the folder. Four short messages to the person instead of a long terminal session.
- The rehearsal image carries probe through a build argument, not a second committed list: the production list stays the only one in git, and apps/api has probe as a devDependency so esbuild can resolve the rehearsal list.

## Watch out
- A prepared file lasts 24 h and the cleanup runs at 04:30, so the check that an unused one disappears ends the second night after the upload, and the backup check the first night: a Pi close with files spans two nights.
- The removal safety check refuses rm with a variable path even inside a remote ssh string: use literal absolute paths, or avoid the temporary file.

In the code: docker/Dockerfile (ARG DOMUS_MODULES), tooling/scripts/modules-generate.ts (--rehearsal), docs/despliegue.md («Ensayar con archivos», «Comprobar los archivos»), .scratch/fase-1d3/issues/10-la-pi-y-el-cierre.md.

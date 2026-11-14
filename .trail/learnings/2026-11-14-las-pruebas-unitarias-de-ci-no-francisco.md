---
title: Las pruebas unitarias de CI no deben correr como root
author: Francisco
date: 2026-11-14
standing: true
id: l-2080bc96
scope: repo
status: active
src: init-sessions
touches:
  - ".github/workflows/validate-prs.yml"
---

## Watch out
- En el contenedor node:22-trixie el job corría como root. Git rechazó el checkout por propiedad dudosa, y una carpeta sin permisos no frenaba una prueba, así que las pruebas de fallos no eran fiables.
- In the code: En .github/workflows/validate-prs.yml el job unit corre en el runner como usuario normal, con restic 0.18.0 desde su release. El secreto de copias debe tener uid 1000.

_From past Claude sessions here, Nov 12._

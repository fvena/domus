---
title: "Restaurar usa una marca persistente, no un camino único sin abrir la base anterior"
author: Francisco
date: 2026-11-14
standing: true
id: l-30a3284f
scope: repo
status: active
src: init-sessions
---

## Decided
- Un diseño más simple dejaba un intervalo en el que el arranque usaba domus.db sin su WAL, y un corte ahí perdía escrituras confirmadas. Invertir el orden tampoco sirve, porque SQLite no comprueba que un WAL viejo sea de la base nueva.
- In the code: En el restore (ADR 0026) publica restore.pending de forma atómica: escribe .tmp, haz fsync, rename y fsync de /data. Una marca ilegible bloquea el arranque y nunca se trata como inexistente.

_From past Claude sessions here, Nov 12._

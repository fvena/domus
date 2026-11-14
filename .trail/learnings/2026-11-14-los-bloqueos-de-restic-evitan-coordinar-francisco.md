---
title: "Los bloqueos de restic evitan coordinar a mano copia, limpieza y restauración"
author: Francisco
date: 2026-11-14
standing: true
id: l-3872cbd8
scope: repo
status: active
src: init-sessions
---

## Decided
- Pausar el planificador solo marca paused y no detiene lo que ya está en curso, así que no era una exclusión real. Se optó por apoyarse en los bloqueos de restic.
- In the code: Usa restic unlock antes de cada copia y --retry-lock 30m en el restore del ensayo. No escribas pruebas de la exclusión de restic: es su garantía, no nuestro código.

_From past Claude sessions here, Nov 12._

---
title: "Restaurar copia y archivos en tres pasos, marca de restauración al final"
author: Francisco
date: 2026-11-14
standing: true
id: l-f17d3611
scope: repo
status: active
src: init-sessions
---

## Decided
- Si un corte llega antes de la marca, basta repetir la preparación. Si llega después, la recuperación puede dar los ficheros por instalados. Por eso la marca va tras instalar todos los contenidos.
- In the code: Orden en el restore de la 1d3 (ADR 0028): 1) preparar, comprobar y sanear la copia aparte; 2) instalar y sincronizar los contenidos de archivo; 3) publicar la marca pendiente e intercambiar la base.

_From past Claude sessions here, Nov 13._

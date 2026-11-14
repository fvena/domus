---
title: Un fallo al vaciar la carpeta de preparación debe contar como copia fallida
author: Francisco
date: 2026-11-14
standing: true
id: l-3ee81160
scope: repo
status: active
src: init-sessions
touches:
  - packages/platform/backups/index.ts
  - packages/test-utils/backups.test.ts
---

## Watch out
- En la revisión se vio que el primer vaciado de la carpeta de preparación corría fuera del bloque que anota el intento fallido. Si fallaba, /health seguía en none-yet y nadie recibía aviso.
- In the code: En packages/platform/backups/index.ts el primer emptyFolder(staging) va dentro del try que llama a marks.failed(). Sin copia guardada, un intento fallido debe dar backup-stale. Prueba en packages/test-utils/backups.test.ts.

_From past Claude sessions here, Nov 12._

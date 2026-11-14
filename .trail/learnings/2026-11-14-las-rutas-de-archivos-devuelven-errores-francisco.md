---
title: "Las rutas de archivos devuelven errores como JSON plano, sin el sobre del RPC"
author: Francisco
date: 2026-11-14
standing: true
id: l-00064734
scope: repo
status: active
src: init-sessions
touches:
  - ".scratch/fase-1d3/spec.md"
---

## Decided
- Dos tareas paralelas (subida y descarga) iban a decidir cada una su formato de error. Se fijó una sola regla en la spec antes de que divergieran.
- In the code: Las rutas POST /api/files y /api/files/download responden con ORPCError.toJSON() tal cual, sin el sobre { json } del serializador RPC. Está en .scratch/fase-1d3/spec.md.

_From past Claude sessions here, Nov 13._

# Perfiles para personas y permisos sí o no

Los perfiles son solo para personas: `admin` (Paco), `member` (Rocío) y `device` (la cuenta compartida). No hay perfil para menores, porque en casa no hay niños. Los permisos son sí o no, por área y nivel, unos 50; no hay permisos por acción suelta, para que la tabla quepa en una pantalla y se entienda.

Fecha: 2026-11-11. Preguntas del grilling: P9, P14.
Precisado por el ADR 0023: un permiso es un nivel por área, `read`, `write` o `manage`, y cada uno incluye los anteriores; el admin tiene `manage` en todas y cambia el acceso de `member` y de `device`.

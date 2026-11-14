# 01. Ajustes previos: la sesión caducada no vive y `no-store` en toda la API

Status: ready-for-agent
Blocked by: —

Spec: [`../spec.md`](../spec.md), secciones «Cuando termina una sesión» (la regla única de que una sesión vive) y «`no-store`». ADR 0029.

## Qué construir

Dos ajustes pequeños que preparan la 1d4 y no dependen de nada.

- **Una sesión caducada ha terminado aunque su fila siga en la base.** La regla única de que una sesión vive pasa a exigir también que no haya caducado, con el reloj de la plataforma. Cambia a la vez en todos sus usos: comprobantes, archivos preparados, la limpieza de preparados y las referencias de archivo. El canal y las entregas la usarán después.
- **Ninguna respuesta de la API se guarda en una caché.** Un middleware en `/api/*` pone `Cache-Control: no-store` en toda respuesta, también en los errores y en las rutas de Better Auth.

## Criterios de aceptación

Caducidad:

- [ ] Con el reloj de pruebas pasado de su caducidad y la fila de la sesión todavía en la base, un comprobante de esa sesión ya no sirve.
- [ ] En el mismo caso, un archivo preparado de esa sesión ya no se consume y la limpieza lo recoge.
- [ ] Un instante antes de caducar, la sesión sigue viva en todos esos usos.
- [ ] Las pruebas de la 1c y la 1d3 que ya cubren la sesión revocada siguen pasando.

`no-store`:

- [ ] Una respuesta buena y un error de cada familia de rutas llevan `Cache-Control: no-store`: una RPC de la plataforma, una acción de `probe`, `POST /api/files`, `POST /api/files/download` y `/api/auth/*`.
- [ ] `/health` y la web compilada no cambian.

- [ ] `pnpm check` pasa.

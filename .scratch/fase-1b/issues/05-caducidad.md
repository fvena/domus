# 05. Caducidad del contenido del registro

Status: ready-for-agent
Blocked by: 04

Spec: [`../spec.md`](../spec.md), secciones «Registro de acciones», «Idempotencia» y «Deshacer». ADR 0022.

## Qué construir

El contenido de cada entrada del registro (entrada, resultado e inversa) deja de usarse al pasar su plazo, sin que la clave pierda su efecto: pasado `expiresAt`, un reintento responde `result-expired` sin ejecutar y deshacer responde `expired`.

- `expiresAt` se calcula al confirmar con el reloj de la plataforma: instante más el plazo. El plazo es una opción de `createPlatform` (y de la construcción de pruebas), 30 días por defecto; cambiarlo solo afecta a las entradas nuevas.
- El contenido está caducado cuando `now >= expiresAt`. La comprobación vale para cualquier acceso al contenido: repetir y deshacer.
- Misma clave y misma huella con el contenido caducado: reautorizar y responder `result-expired`, nunca ejecutar. Deshacer una entrada caducada: no se puede deshacer `expired`.
- El contenido caducado sigue en disco; su limpieza física es de la 1d. `log()` lo sigue mostrando, solo en pruebas.

## Aceptación

- [ ] Pruebas de `probe` con el reloj: un milisegundo antes de `expiresAt` se repite y se deshace; en `expiresAt` exacto y después se responde `result-expired` y `expired`; cambiar el plazo no altera las entradas existentes; tras caducar y reiniciar sobre un fichero con ruta explícita, la misma clave sigue sin ejecutarse.
- [ ] Pasan `pnpm format:check`, `pnpm lint`, `pnpm type-check` y `pnpm test`.

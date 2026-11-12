# 05. Caducidad del contenido del registro

Status: resolved
Blocked by: 04

Spec: [`../spec.md`](../spec.md), secciones «Registro de acciones», «Idempotencia» y «Deshacer». ADR 0022.

## Qué construir

El contenido de cada entrada del registro (entrada, resultado e inversa) deja de usarse al pasar su plazo, sin que la clave pierda su efecto: pasado `expiresAt`, un reintento responde `result-expired` sin ejecutar y deshacer responde `expired`.

- `expiresAt` se calcula al confirmar con el reloj de la plataforma: instante más el plazo. El plazo es una opción de `createPlatform` (y de la construcción de pruebas), 30 días por defecto; cambiarlo solo afecta a las entradas nuevas.
- El contenido está caducado cuando `now >= expiresAt`. La comprobación vale para cualquier acceso al contenido: repetir y deshacer.
- Misma clave y misma huella con el contenido caducado: reautorizar y responder `result-expired`, nunca ejecutar. Deshacer una entrada caducada: no se puede deshacer `expired`.
- El contenido caducado sigue en disco; su limpieza física es de la 1d. `log()` lo sigue mostrando, solo en pruebas.

## Aceptación

- [x] Pruebas de `probe` con el reloj: un milisegundo antes de `expiresAt` se repite y se deshace; en `expiresAt` exacto y después se responde `result-expired` y `expired`; cambiar el plazo no altera las entradas existentes; tras caducar y reiniciar sobre un fichero con ruta explícita, la misma clave sigue sin ejecutarse.
- [x] Pasan `pnpm format:check`, `pnpm lint`, `pnpm type-check` y `pnpm test`.

## Comments

- Hecha en `HASH`.
- El plazo es la opción `retention` de `createPlatform` (y de `createTestPlatform`), en milisegundos; sin ella, 30 días (`DEFAULT_RETENTION`, privado de `platform.ts`). La spec no fija qué valores valen: arrancar con un plazo que no sea un número entero positivo de milisegundos (0, negativo, decimal, `NaN`, infinito) falla al crear la plataforma, como una ruta relativa.
- Caducado es `now >= expiresAt` con el reloj de la plataforma, en un solo sitio (`isExpired` de `platform/actions`). Repetir caducado: tras reautorizar, conflicto `result-expired`, en la sección idempotente que comparten escribir y deshacer, así que un reintento de `undo` cuya propia entrada caducó también responde `result-expired`. Deshacer una entrada caducada: `UNPROCESSABLE_CONTENT` con `{ reason: "expired" }`, después de `irreversible` y antes de `changed-since` y la autorización.
- Una denegación gana a la caducidad: un reintento caducado y denegado responde no permitido.
- `KeyedEntry` y `NumberedEntry` de `platform/audit` llevan `expiresAt`.
- Reautorizar un reintento de `undo` lee la inversa guardada de la entrada original para construir la petición, aunque haya caducado; solo sirve para decidir, no se devuelve ni se ejecuta. Cuando la 1d borre el contenido caducado habrá que decidir con qué petición se reautoriza ese reintento.

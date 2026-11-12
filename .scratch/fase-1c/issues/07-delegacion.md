# 07. Delegación

Status: resolved
Blocked by: 03

Spec: [`../spec.md`](../spec.md), secciones «Delegación» y «La decisión» (paso 2). ADR 0023, ADR 0008.

## Qué construir

La tabla de delegación de cada cuenta y su efecto en la decisión vía Kira:

- **La tabla** guarda `no`, `sí` o `confirmar` por área y nivel, y un valor no arrastra a los demás. Se crea una sola vez, al crear la cuenta: `read` y `write` copian el permiso de ese momento, `manage` empieza en `no` y ninguno empieza en `confirmar`. Después no sigue los cambios de permisos, y un área sin fila vale `no`.
- **La decisión vía Kira** (contexto sintético con `via`) deniega con `no`. El valor `confirmar` lo convierte en confirmación la 08. Hasta entonces, deniega.
- **Leer la delegación** es una lectura de la plataforma: cada persona lee la suya, y el admin, la de la cuenta de aparato. Cambiarla es sensible y llega con la 09.
- **La preparación privilegiada** de las pruebas puede fijar filas de delegación.

## Aceptación

- [x] **Unitarias de la decisión:** delegación no acumulativa (leer `sí` y escribir `no` en la misma área), `no` vía Kira, un área sin fila, y sin `via` la delegación no se aplica.
- [x] Una cuenta nueva nace con la delegación copiada y `manage` en `no`. Subirle después un permiso no cambia su delegación.
- [x] **`probe` vía Kira:** se deniega con `no`, se permite con `sí`, y nunca supera el permiso de la cuenta.
- [x] Leer la delegación: cada persona la suya, el admin la de la cuenta de aparato, y el admin no puede leer la de otra persona.
- [x] Pasan todas las comprobaciones, y la generación no deja cambios.

## Comments

- Hecho en `0682361`.
- Dónde está cada cosa: la tabla `platform_delegation` (cuenta, área, nivel y valor `no`/`yes`/`confirm`) en `packages/platform/schema.ts`, generada como `0003_open_tarot` (posición 4). `identity/delegation.ts` tiene `setDelegation`, `startDelegation` (la delegación de partida) y `readDelegation`, la lectura de la plataforma. `AccessView` gana `delegated(cuenta, área, nivel)`, y `decide` aplica el paso 2 con `delegationOf`: vía Kira, todo lo que no sea `yes` deniega. **Para la 08:** `confirm` deniega hoy en ese mismo `if`, y ahí debe pasar a pedir confirmación.
- La delegación de partida se escribe en `insertAccount`, en la misma transacción, sobre las áreas registradas, copiando `grantOf` de ese momento. Por eso `insertAccount(connection, cuenta, áreas, ahora)` y `ensureDeviceAccount(connection, áreas, ahora)` piden ahora las áreas: la plataforma las guarda (`areasOf`). **Para la 04:** el comando `pnpm accounts` tiene que pasar las áreas registradas al crear la cuenta. Una cuenta creada antes de esta migración (la de aparato de una base ya abierta con la 03) no tiene filas, y vale `no` en todo.
- `AuthorizationRequest` gana `subject`: la cuenta cuyos ajustes propios toca una operación de la plataforma. `decide` solo deja llegar a la propia cuenta, y al admin a la de la cuenta de aparato. Leer la delegación pide `read` en el área `platform` con `subject`, así que vía Kira pasa además por la delegación de `platform`. **Para la 09:** cambiar la delegación puede usar el mismo `subject`; cambiar permisos tiene otra regla (el admin sobre `member` y `device`, nunca los suyos).
- `test-utils`: `prepare.delegation(cuenta, área, nivel, valor)` y `test.delegation(contexto, cuenta)`, que devuelve cada área registrada con sus tres niveles (`no` donde no hay fila). La denegación es `FORBIDDEN`; la 05 decide si alguna pasa a «no encontrado».
- Abierto: leer la delegación aún no se sirve por HTTP. Entra cuando las operaciones de la plataforma tengan su forma en la puerta (04).

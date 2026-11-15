# 01. Las garantías vía el agente, en la autorización

Status: resolved
Blocked by: —

Spec: [`../spec.md`](../spec.md), sección «La autorización» y costura 1. ADR 0034 y ADR 0010.

## Qué construir

Antes de quitar el mandato, las garantías que hoy se cumplen por su canal `contexto` y por la lista de la puerta pasan a decidirse por `via` en `platform/authorization`. Así siguen valiendo para cualquier agente futuro cuando el mandato ya no exista. El mandato sigue funcionando durante este ticket.

- **Un comprobante no cuenta con `via`.** Vía el agente, una operación que pide comprobante solo se completa cuando la persona confirma desde la app, como hoy.
- **Un contexto con `via` no confirma ni rechaza.** Es un cambio de comportamiento, no solo de lugar: hoy el cierre depende de que el mandato lleve siempre el canal `contexto`, y un contexto con `via` que declara el canal `app` no está cerrado. Este ticket lo cierra y lo prueba.
- **La lista de operaciones de la plataforma que admiten `via`**, hoy `log/read` y `log/undo`, pasa de la puerta a la decisión. Cualquier otra operación de la plataforma, también una desconocida o una nueva, se deniega vía el agente. La puerta deja de llevar esa lista.
- **Quien confirma no es quien pide.** Una pendiente nacida vía el agente y confirmada por la persona desde la app conserva el `via` de origen para la delegación y para el registro, pero la persona que confirma no pasa a ser el agente: la confirmación es suya, por el canal `app` y sin `via`.
- **Las pruebas de obligaciones** de `mandates-http` y `platform-mandates-http` se reescriben sobre el contexto sintético con `via` (`test.context` y `test.member`), por el camino de las acciones, y la confirmación de la persona va con `browser()` por HTTP. Las que solo prueban el mecanismo se quedan hasta la 03.

## Criterios de aceptación

- [x] Vía el agente, con un comprobante válido y el canal `app`, una operación que lo pide no se completa; confirmada después por la persona desde la app, sí.
- [x] Un contexto con `via` no confirma ni rechaza una pendiente, con el canal `app` y también con `contexto`; la pendiente sigue sin consumir.
- [x] Vía el agente, `log/read` y `log/undo` funcionan dentro de la delegación, y `log/undo` se deniega al retirarla.
- [x] Vía el agente, cada otra operación de la plataforma se deniega, también un nombre desconocido.
- [x] Una pendiente nacida vía el agente y confirmada por la persona con `browser()` desde otra sesión suya conserva la delegación de entonces, y su entrada en el registro lleva el `via` de origen.
- [x] Siguen probadas sobre el contexto sintético: la delegación en «no», «sí» y «pedir confirmación»; un área sin fila; la delegación que no supera el permiso; una acción `manage` que no se completa; la clave de idempotencia por cuenta y `via`; `via` en el registro.
- [x] Las pruebas del mandato por HTTP siguen pasando.
- [x] `docs/agents/packages.md` describe dónde vive ahora la lista de operaciones que admiten `via`.
- [x] `pnpm check` pasa.

## Comments

- Hecho en `9ce0d8e`.
- La lista vive en `packages/platform/authorization/via.ts` (`admitsVia`), que sustituye a `authorization/mandates.ts` y a `admitsMandate`. `decide` la pregunta primero: con `via`, de las acciones `platform.*` solo pasa `platform.readLog`, y deshacer pasa entero (lo que se autoriza es su inversa, que sigue el resto de la decisión). Un nombre desconocido o escrito de otra forma se deniega.
- Lo que no va por el camino de las acciones pregunta a `asksByItself` de la autorización: `password/change` y `sessions/list` en la puerta, `requestProof` en `identity/proofs.ts`, y confirmar y rechazar en `reachable` de `actions/answering.ts`, que responde `FORBIDDEN` antes de buscar la pendiente (antes, con `via` y el canal `app`, era `NOT_FOUND`).
- El comprobante: `AuthorizationRequest` lleva `confirmedBy`, el contexto de quien contestó la pendiente, que `answering.ts` pasa en lugar de `confirmed: true`. Cuenta solo si lo trae una persona por `app` y sin `via`. Una repetición vía el agente de una escritura `manage` ya confirmada pide su comprobante y no lo acepta nunca, tampoco uno recién pedido por la persona, que queda sin gastar (`proofs.test.ts`).
- La puerta ya no lleva lista: pasa `{ mandate: true }` en todas las operaciones de la plataforma y decide la autorización. Por eso, con un mandato, esas operaciones responden ahora `FORBIDDEN` en vez de `UNAUTHORIZED`; `platform-mandates-http.test.ts` lo recorre así hasta la 03.
- Las pruebas de obligaciones de `mandates-http` y `platform-mandates-http` pasan al contexto sintético: `delegation.test.ts` (no, sí y pedir confirmación en cada nivel, área sin fila, registro ajeno oculto, y la pendiente que la persona confirma con `browser()` por HTTP), `proofs.test.ts`, `log.test.ts` (deshacer tras retirar la delegación lo que escribió el agente), `idempotency.test.ts` (repetición desde otra sesión), `confirmations.test.ts` y `sensitive.test.ts` (cada operación de la plataforma vía el agente). En los ficheros HTTP queda solo el mecanismo.
- Leer la delegación vía Kira se permitía en las pruebas sintéticas y ahora se deniega: las pruebas que la usaban para crear una pendiente (`identity/command.test.ts`, `test-utils/restore.test.ts`) usan `platform.readLog`.
- Hasta la 04, la confirmación en contexto con su ventana solo la alcanza un contexto `contexto` sin `via`, que nada produce en producción; las pruebas de la ventana y del aparato compartido contestan con ese contexto. La 04 las borra.
- La guía (`permisos.md`) nombraba `admitsMandate`: cambia solo esa frase; la revisión completa es de la 06.

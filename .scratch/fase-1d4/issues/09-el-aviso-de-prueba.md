# 09. El aviso de prueba

Status: resolved
Blocked by: 05

Spec: [`../spec.md`](../spec.md), sección «El aviso de prueba» y la fila de `notifications/test` en «Errores de las rutas nuevas». ADR 0029.

## Qué construir

Una persona pide «envíame un aviso de prueba» y le llega al móvil. Existe para que la fase 2 reciba un aviso real antes de que haya un módulo que los envíe.

- **`notifications/test`** en `platformContract` como `notifications: { test }`: una escritura irreversible de la plataforma, con clave de idempotencia y su entrada en el registro de acciones.
- **Autorización**: solo una sesión de la app, sin `via`, de una cuenta de persona; sin nivel de ningún área y sin comprobante.
- **El aviso**: un `notice` con `{ kind: "test", to: <el actor> }`, cuyo reparto no comprueba registro y cuyas entregas llevan `{ kind: "test", notice }`.

## Criterios de aceptación

- [x] Con suscripción, la petición llega al servicio falso y su contenido descifrado es `{ kind: "test", notice }`. Solo llega a las suscripciones habilitadas de quien lo pide.
- [x] Sin ninguna suscripción, la escritura responde bien y el aviso termina `distributed` sin entregas, sin dejar nada pendiente.
- [x] La escritura deja su entrada en el registro, y repetirla con la misma clave devuelve el acuse y no envía otro.
- [x] Es irreversible: deshacerla no se puede.
- [x] La cuenta `device` y `via` reciben `FORBIDDEN`. No pide comprobante ni nivel de ningún área.
- [x] `pnpm check` pasa.

## Comments

- Hecho en `f735f31`.
- La operación es `platform.testNotice` (`notifications/operations.ts`), sin entrada, con resultado `{ to }`; la puerta la sirve en `notifications/test` y `test-utils` la ofrece como `test.testNotice(context, { idempotencyKey })`, que sirve para probar `via` con un contexto sintético.
- «Sin nivel de ningún área» es la marca `personal` de `PlatformOperation`, `RegisteredAction` y `AuthorizationRequest`: `decide` la atiende la primera, y solo deja pasar una persona, sin `via` y desde el canal `app`; un comprobante que traiga responde `STEP_UP_REQUIRED`. Otra operación propia de una persona que no deba pedir nivel puede usar la misma marca.
- En `notifications/notices.ts`, el `payload` de `notice` es una unión, y un `decisionOf(notice)` local elige entre `testNoticeDecision(view, to)` (nuevo, en `authorization/notices.ts`) y `noticeDecision(view, to, records(notice))`, en el reparto y en la entrega. La 06 y la 07 no lo tocan salvo por esas dos llamadas.
- Decidido sin preguntar, y anotado en la spec: el nombre de la operación, su resultado `{ to }`, la marca `personal` y la comprobación del canal `app`.

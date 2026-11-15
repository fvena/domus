# 04. Retirar el canal `contexto` y la identidad `voice`

Status: resolved
Blocked by: 03

Spec: [`../spec.md`](../spec.md), secciones «El contexto verificado», «La autorización» y «Las confirmaciones», y costura 1. ADR 0034 y ADR 0023.

## Qué construir

Sin mandatos, nada puede producir el canal `contexto` ni la identidad `voice`. Desaparecen, y con ellos el «sí» por voz en 60 s. La regla del aparato compartido se queda solo con su denegación.

- **El contexto verificado:** el canal se queda con un solo valor, `app`; la identidad, con `password` y `device`; sale el campo de la conversación.
- **La autorización:** sale la decisión `confirm-in-context`. En una lectura de un área que declara `confirmOnSharedDevice`, la cuenta de aparato se deniega; el caso del miembro reconocido en un aparato compartido desaparece.
- **Las confirmaciones:** una pendiente se confirma o se rechaza solo desde la app, por la misma persona, en sus 24 h. Sale el plazo de unos 60 s.
- **Compatibilidad temporal con el esquema.** Las columnas de «solo por `contexto`» y del cierre de su ventana siguen existiendo hasta la 05, y el cierre de la ventana no admite nulos ni tiene valor por defecto. Hasta entonces se conserva el mínimo código de persistencia que las escribe, sin significado funcional, y una pendiente antigua marcada «solo por `contexto`» sigue sin poder confirmarse ni rechazarse desde la app. La 05 elimina los dos restos.

## Criterios de aceptación

- [x] La cuenta de aparato, con el área abierta por el admin, no lee un área de `probe` que declara `confirmOnSharedDevice`, y un miembro sí la lee en su propio aparato.
- [x] `confirm-in-context` ya no es una decisión, y ninguna pendiente nueva nace «solo por `contexto`».
- [x] Una pendiente antigua «solo por `contexto`», preparada en la base, no se confirma ni se rechaza desde la app.
- [x] Las pendientes ordinarias se confirman y se rechazan como antes, con su caducidad de 24 h.
- [x] Las pruebas de la falsificación por HTTP siguen probando que la puerta ignora el canal y la identidad que declara el cliente.
- [x] `docs/agents/packages.md` queda sin el canal `contexto`, la identidad `voice` y la ventana.
- [x] `pnpm check` pasa.

## Comments

- Hecho en el commit «feat(platform): retire the channel contexto and the identity voice».
- El contexto verificado (`authorization/context.ts`): `Channel` es solo `app`, `IdentityProof` es `password` o `device`, y sale `conversation`. `deviceAccount` se queda: lo guarda el origen de cada pendiente.
- La regla del aparato compartido (`decide`, paso 5) mira la cuenta representada: si su rol es `device`, una lectura de un área con `confirmOnSharedDevice` se deniega. Ya no mira `deviceAccount`, porque el caso del miembro reconocido desaparece. `confirm-in-context` sale de `DECISIONS`, así que `decisionOf` lo trata como una respuesta desconocida y deniega.
- Las comprobaciones del canal `app` en `decide` (lo personal y el comprobante) se quedan, aunque hoy siempre se cumplen: la spec deja el campo para que la fase 5 decida si llega otro canal.
- Las confirmaciones (`actions/confirmations.ts`, `actions/answering.ts`): `ConfirmationTimes` es solo `expiry`, y la opción `confirmation` de la plataforma y de `createTestPlatform` pierde `window`. Sale el conflicto `window-closed`. `window_closes_at` se escribe con la misma caducidad y `context_only` con 0, sin significado; una pendiente con `context_only = 1` responde `NOT_FOUND` al confirmar y al rechazar desde la app, y sigue igual en la base. La 05 se lleva los dos restos.
- Detalle que la spec no tomaba: una lectura repetida reutiliza su pendiente solo desde la misma sesión, y dos lecturas sin sesión nunca comparten una (antes las unía la conversación). Añadido a la spec, «Las confirmaciones».
- Las pruebas: el aparato compartido en `modules/probe/tests/confirmations.test.ts` (el admin abre `probe.health` a la cuenta de aparato con `setPermission` y su comprobante); la pendiente antigua, preparada con un `UPDATE` en la base, y una pendiente nacida vía Kira en la pantalla de la cocina que se confirma desde la app, en `packages/platform/actions/confirmations.test.ts`; la regla en `decide`, en `authorization.test.ts`. Salen las de la ventana, la conversación y el «sí» en contexto. Las de la falsificación por HTTP (`modules/probe/tests/http.test.ts`, `platform/http/http.test.ts`) no cambian: siguen enviando `contexto`, `voice` y una conversación que la puerta ignora.
- `docs/agents/packages.md` y `CODING_STANDARDS.md` quedan al día. `GLOSSARY.md`, la guía (`permisos.md`, `cuentas.md`) y el README de arquitectura siguen nombrando el canal `contexto` y la voz: son de la 06.

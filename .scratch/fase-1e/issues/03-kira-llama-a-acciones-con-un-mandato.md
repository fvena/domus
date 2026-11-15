# 03. Kira llama a acciones con un mandato

Status: resolved
Blocked by: 02

Spec: [`../spec.md`](../spec.md), secciones «Mandatos», «La puerta» y «Autorización vía Kira». ADR 0030 y ADR 0023.

## Qué construir

El recorrido central de la 1e: con su llave y un mandato, Kira ejecuta una acción de `probe` en nombre de una persona, dentro de su tabla de delegación, y la entrada del registro lleva la cuenta y `via = "kira"`.

- **La tabla de mandatos**, en una migración generada de la plataforma: el SHA-256 del id (clave), la app, la cuenta, el aparato, la sesión, la cuenta del aparato, `identity`, la conversación, cuándo se emitió y cuándo caduca.
- **Emitir** en `platform/identity`: recibe la sesión de origen y la app, y toma de la sesión la cuenta, el aparato, la cuenta del aparato y `identity`, sin poder cambiarlos. Rechaza una app que no recibe mandatos y una sesión que no vive. Devuelve el id, 32 bytes aleatorios en base64url. Solo lo expone `@domus/platform/testing`, al que ningún código de producción llega.
- **La vida**: 15 minutos por defecto, ajustable en las opciones de la plataforma. Desde `now >= expiresAt` ya no vale.
- **Resolverlo en la puerta**: con `domus-mandate`, se busca por el hash, y tiene que estar sin caducar, ser de la app de la llave y tener una sesión viva según la regla única de la plataforma. Así se sella el contexto: la cuenta, `via` (la app), el aparato, la sesión, la cuenta del aparato, el canal `contexto`, `identity` y la conversación. Cualquier fallo responde `UNAUTHORIZED`.
- **Lo que abre**: las acciones de los módulos. Las operaciones de la plataforma siguen cerradas a los mandatos hasta la 05.
- **Para probarlo**: `test.mandate(browser, { app?, conversation? })`, que emite por la función real a partir de la sesión de ese `browser()`. Las llamadas de Kira usan `clientFor` con un transporte que lleva `Authorization` y `domus-mandate`, y el `fetch` de la puerta, sin la cookie del navegador.

## Criterios de aceptación

- [x] Camino positivo: con la delegación abierta, una lectura y una escritura de `probe` vía Kira funcionan, y la entrada del registro lleva la cuenta de la persona y `via = "kira"`, nunca la llave ni el mandato.
- [x] Una llave válida sin mandato, con un mandato mal formado o con uno desconocido responde `UNAUTHORIZED` en una acción.
- [x] Un mandato caducado responde `UNAUTHORIZED` en el instante exacto de su caducidad y funciona un milisegundo antes. Cambiar la vida en las opciones la cambia.
- [x] Un mandato emitido para `kira` y presentado con la llave de una app de prueba responde `UNAUTHORIZED`. Emitir para una app que no recibe mandatos falla.
- [x] Emitir desde una sesión que ya no vive falla, y el mandato hereda la `identity` de su sesión.
- [x] La delegación en «no», «sí» y «pedir confirmación» se respeta en cada nivel, un área sin fila deniega, y la delegación nunca supera el permiso de la persona.
- [x] Una escritura con «pedir confirmación» vía Kira deja una pendiente que la persona confirma por `app` desde otra de sus sesiones, conservando la delegación de entonces.
- [x] Una acción `manage` vía Kira no se completa.
- [x] La misma clave de idempotencia desde la app y vía Kira no choca. Repetir vía Kira con otro mandato de la misma persona da un acuse sin ejecutar.
- [x] Un registro privado ajeno vía Kira responde `NOT_FOUND`, y una acción que la delegación niega, `FORBIDDEN`.
- [x] Las reglas de dependencias siguen impidiendo que el código de producción llegue a emitir mandatos.
- [x] La migración se aplica sobre una base con la de la 01, y dos generaciones seguidas no dejan cambios.
- [x] `pnpm check` pasa.

## Comments

- Hecho en `8161ac6`.
- Emitir no vive en `platform/identity`, como decía el ticket, sino en `platform/testing/mandates.ts` (`issueMandate`), exportado por `@domus/platform/testing`. Si viviera en `identity`, cualquier código de producción podría importarlo sin romper ninguna regla; en `testing`, la regla `production-never-reaches-platform-testing`, sin cambiar, prueba el criterio. Leer y resolver sí están en `identity/mandates.ts` (`readMandate`, `mandateHash`, `resolveMandate`). La 5a lleva `issueMandate` a `identity`. Está en la spec («Dónde vive» y «Mandatos»).
- Lo que una sesión da a un contexto está en un solo sitio, `originOf` de `identity/sessions.ts`: la puerta sella con él el contexto de una sesión y `issueMandate` guarda lo mismo. Así el mandato hereda `identity: "password"` y la cuenta del aparato igual a la cuenta, sin que quien emite pueda cambiarlos.
- La puerta: `DoorContext.verify({ mandate: true })` solo lo piden las acciones de los módulos; todas las demás rutas llaman a `verify()` o a `contextOf` sin opción, y con `Authorization` reciben `null`. La 05 abre `log/read` y `log/undo` pasando `{ mandate: true }` en esos dos manejadores, con la lista pura de `platform/authorization`.
- El log de quien opera dice `mandate refused: <motivo>` (`missing`, `malformed`, `unknown`, `expired`, `other-app`, `session-ended`), probado en `platform/http/http.test.ts`.
- La tabla es `platform_mandates` (migración `0016`), con la sesión sin clave foránea: terminar una sesión deja la fila, que ya no resuelve. La 04 borra en la limpieza las caducadas y las de sesiones que no viven, y al restaurar todas. No hay índice por sesión ni por caducidad: la 04 decide si lo necesita su limpieza.
- `test-utils`: `test.mandate(browser, { app?, conversation? })` y la opción `mandateLife`. Las pruebas de la puerta con mandato están en `modules/probe/tests/mandates-http.test.ts`.
- `probe` no tiene una acción que responda `NOT_FOUND` de la plataforma para un registro ajeno: un registro privado ajeno vía Kira no aparece en las listas, `getNote` da `null` y `editNote` responde `NOTE_NOT_FOUND`, como sin Kira.
- Tras la revisión externa: un mandato podía traer un comprobante que la persona pidió en la app desde la misma sesión, porque el comprobante se ata a la cuenta, la sesión y el aparato, no a `via`, y Kira completaba una acción `manage`. `decide` cuenta ahora un comprobante solo por el canal `app`; confirmar desde la app una pendiente nacida de Kira sigue funcionando. Pruebas en `authorization.test.ts` y `mandates-http.test.ts`, y precisados el ADR 0030 y el 0023.

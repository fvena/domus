# 03. Kira llama a acciones con un mandato

Status: ready-for-agent
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

- [ ] Camino positivo: con la delegación abierta, una lectura y una escritura de `probe` vía Kira funcionan, y la entrada del registro lleva la cuenta de la persona y `via = "kira"`, nunca la llave ni el mandato.
- [ ] Una llave válida sin mandato, con un mandato mal formado o con uno desconocido responde `UNAUTHORIZED` en una acción.
- [ ] Un mandato caducado responde `UNAUTHORIZED` en el instante exacto de su caducidad y funciona un milisegundo antes. Cambiar la vida en las opciones la cambia.
- [ ] Un mandato emitido para `kira` y presentado con la llave de una app de prueba responde `UNAUTHORIZED`. Emitir para una app que no recibe mandatos falla.
- [ ] Emitir desde una sesión que ya no vive falla, y el mandato hereda la `identity` de su sesión.
- [ ] La delegación en «no», «sí» y «pedir confirmación» se respeta en cada nivel, un área sin fila deniega, y la delegación nunca supera el permiso de la persona.
- [ ] Una escritura con «pedir confirmación» vía Kira deja una pendiente que la persona confirma por `app` desde otra de sus sesiones, conservando la delegación de entonces.
- [ ] Una acción `manage` vía Kira no se completa.
- [ ] La misma clave de idempotencia desde la app y vía Kira no choca. Repetir vía Kira con otro mandato de la misma persona da un acuse sin ejecutar.
- [ ] Un registro privado ajeno vía Kira responde `NOT_FOUND`, y una acción que la delegación niega, `FORBIDDEN`.
- [ ] Las reglas de dependencias siguen impidiendo que el código de producción llegue a emitir mandatos.
- [ ] La migración se aplica sobre una base con la de la 01, y dos generaciones seguidas no dejan cambios.
- [ ] `pnpm check` pasa.

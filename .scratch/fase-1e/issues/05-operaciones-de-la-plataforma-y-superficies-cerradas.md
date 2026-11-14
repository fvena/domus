# 05. Las operaciones de la plataforma y las superficies cerradas

Status: resolved
Blocked by: 03

Spec: [`../spec.md`](../spec.md), secciones «La puerta» y «Autorización vía Kira». ADR 0030.

## Qué construir

Kira lee y deshace lo de una persona dentro de su delegación, y nada más de la plataforma: todo lo demás, también lo que se añada mañana, rechaza un mandato. Kira nunca confirma.

- **La función pura** en `platform/authorization` con la lista de operaciones de la plataforma que admiten un mandato: `log/read` y `log/undo`. Lo que no está en ella, también una operación desconocida, no lo admite.
- **La puerta** aplica esa lista a las operaciones de la plataforma. Las rutas de Hono y las de Better Auth siguen cerrando cualquier petición con llave.

## Criterios de aceptación

- [x] La función pura admite `log/read` y `log/undo`, y rechaza cada una de las demás operaciones de la plataforma y un nombre desconocido.
- [x] Vía Kira, `log/read` devuelve solo las anotaciones de la persona, dentro de su delegación vigente.
- [x] Vía Kira, `log/undo` deshace una escritura de la persona dentro de su delegación vigente. Tras retirar la delegación del área, el mismo deshacer se deniega aunque la escritura fuera de antes.
- [x] `confirmations/confirm` con llave y mandato se rechaza, y la pendiente sigue sin consumir y se puede confirmar después por `app`. Igual con `/reject`.
- [x] Con llave y mandato se rechazan `delegation/read`, la contraseña, las sesiones, `proofs/request`, `permissions/set`, `delegation/set`, `devices/revoke`, cada operación de las tareas y el aviso de prueba.
- [x] Con llave y mandato se rechazan subir y descargar archivos, el canal en directo, la clave VAPID, las suscripciones y las rutas de Better Auth.
- [x] `pnpm check` pasa.

## Comments

- Hecho en `4251696`.
- La lista es `admitsMandate` de `authorization/mandates.ts`, por la ruta `<grupo>/<nombre>` de cada operación. La puerta no pasa `{ mandate: true }` a mano en los dos manejadores, como decía la 03: todos los manejadores de la plataforma dan su llamada entera (`{ context, path, input }`) a `verifiedSession`, `signedIn` o `platformWrite`, y `verifiedSession` pregunta a la lista con la ruta que da oRPC, nunca con la URL que escribió el cliente. Así decide solo la lista y una operación nueva nace cerrada. Está en la spec («La puerta», detalles de la 05).
- Vía Kira, `log/read` pide la delegación de `platform` en `read`, y `log/undo` la de la inversa en el momento de deshacer; ya lo hacía el camino de las acciones, la 05 solo les abre la puerta.
- Las pruebas están en `modules/probe/tests/platform-mandates-http.test.ts`. La de las superficies cerradas recorre `platformContract`: una operación nueva la rompe hasta que se llama allí con llave y mandato buenos o se añade a la lista. Las rutas de Hono y de Better Auth siguen cerradas por lo que hizo la 02, no por la lista.
- Revisión de la fase, en `94c4ae5`: `verifiedSession` de la puerta es ahora `sessionOrMandateContext`, porque también da el contexto de un mandato donde la lista lo admite.

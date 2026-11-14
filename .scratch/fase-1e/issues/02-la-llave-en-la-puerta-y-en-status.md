# 02. La llave en la puerta y en `status`

Status: resolved
Blocked by: 01

Spec: [`../spec.md`](../spec.md), secciones «Llaves» y «La puerta». ADR 0030.

## Qué construir

La puerta reconoce la llave de una app. Con ella, `status` dice qué app llama, y una credencial mala nunca baja a anónima. Todavía no hay mandatos: fuera de `status`, una llave buena tampoco abre nada.

- **Leer `Authorization: Bearer`**: otro esquema, un valor vacío o una forma mala son una llave mala.
- **Comprobar la llave**: se busca por id, se compara el hash en tiempo constante, y la llave no puede estar revocada ni ser de una app que ya no está en la lista. Todos los fallos dan la misma respuesta, y el motivo va solo al log de quien opera, sin el valor.
- **El último uso**, con el reloj de la plataforma, como mucho una vez por minuto por llave y fuera de la transacción de la acción.
- **Cookie de sesión y llave a la vez**: `UNAUTHORIZED`. La cookie del aparato y las demás no cuentan.
- **`status`**: sin credencial sigue siendo público. Con una llave válida responde además `app` (opcional en el contrato, sin subir `PROTOCOL`). Con una llave mala responde `UNAUTHORIZED`.
- **Todas las demás rutas** (oRPC, Hono y Better Auth): con llave, `UNAUTHORIZED`, cada una con el formato de errores que ya usa.
- **Para probarlo**: `test.prepare.key(app)`, que crea una llave real por la misma función que el comando, y la opción `apps` de `createTestPlatform`, con apps de prueba que nunca reciben mandatos.

## Criterios de aceptación

- [x] `status` sin credencial responde como hoy; con la llave de `kira`, `app: "kira"`; con la de una app de prueba, su nombre.
- [x] `status` responde `UNAUTHORIZED` con una llave ausente tras `Bearer`, mal formada, desconocida, revocada, con un id válido y el secreto equivocado, de una app que ya no está en la lista, o con otro esquema de `Authorization`.
- [x] Una petición con llave y la cookie de sesión de Better Auth responde `UNAUTHORIZED`, también con una sesión válida. Con llave y otras cookies, la llave se trata sola.
- [x] Con una llave buena, cada familia de rutas responde `UNAUTHORIZED`: una acción de `probe`, una operación de la plataforma, subir y descargar archivos, el canal en directo, la clave VAPID, las suscripciones, iniciar y cerrar sesión.
- [x] Ni el valor de `Authorization` ni el de `domus-mandate` aparecen en una respuesta de error.
- [x] El último uso se anota en la primera petición y no se reescribe antes de un minuto en el reloj de pruebas. Después sí.
- [x] Las funciones puras de leer la cabecera cubren cada forma mala, los espacios y las mayúsculas del esquema.
- [x] Las pruebas de HTTP de la 1c y la 1d siguen pasando sin cambios.
- [x] `pnpm check` pasa.

## Comments

- Hecho en `7204ce6`.
- La puerta (`platform/http`) tiene `appOf(request)`: lee la cabecera con `readAuthorization` (`identity/keys.ts`, pura), rechaza la cookie de sesión (`getSessionCookie` de Better Auth), comprueba con `checkKey` sobre `appsOf(platform)` y anota el último uso con `noteKeyUse`, fuera de toda transacción. Solo la llama `status`, por el `app()` del contexto de oRPC. La 03 puede llamarla desde las rutas que admiten mandato antes de resolverlo.
- `contextOf` devuelve `null` en cuanto la petición trae `Authorization`, antes de mirar la sesión: así toda ruta que pide cuenta, de oRPC o de Hono, responde `UNAUTHORIZED` con su formato, también junto a una sesión viva. La 03 cambia esa línea por resolver el mandato.
- Las rutas cerradas rechazan la llave por traer la cabecera, sin comprobarla: no anotan último uso ni dejan motivo en el log. Iniciar y cerrar sesión las rechaza Better Auth desde un `before` de sus hooks, con su propio `{ code: "UNAUTHORIZED", message }`.
- El log de quien opera es la opción `log` de `createHttpHandler` (`console.warn` si no se da), con `key refused: <motivo>`; `test-utils` lo calla y la prueba de los motivos está en `platform/http/http.test.ts`.
- `test-utils`: `prepare.key(app)`, `keys()` (lo que muestra `keys list`), `revokeKey(id)`, la opción `apps` y `PROTOCOL`. Las apps de prueba entran por el runtime de la plataforma (`apps`), nunca reciben mandatos, y un nombre repetido, `kira` incluido, no abre la plataforma. Las pruebas de la puerta con llave están en `modules/probe/tests/keys-http.test.ts`, con las llaves construidas en tiempo de ejecución.
- Decisiones de detalle, también en la spec («La puerta» y «Decisiones de prueba»): mayúsculas del esquema, espacios y tabulador; qué cookie cuenta; los motivos del log; el último uso se reescribe desde el minuto justo.

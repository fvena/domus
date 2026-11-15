# 03. Retirar las llaves y los mandatos

Status: resolved
Blocked by: 01, 02

Spec: [`../spec.md`](../spec.md), secciones «Qué sale y qué queda», «La puerta», «Restaurar y la limpieza» y «Herramientas, Docker y CI», y costuras 1 y 3. ADR 0034.

## Qué construir

La puerta deja de reconocer credenciales de apps: una petición que traiga una llave o un mandato recibe `UNAUTHORIZED`, y nada de la plataforma sabe ya qué es una app conectada.

- **La puerta:** toda petición a `/api` con la cabecera `Authorization`, con cualquier valor, o con la cabecera del mandato responde `UNAUTHORIZED`, antes de mirar la cookie, también en `status` y en las rutas de Better Auth. Cada familia de rutas responde con su formato de errores de siempre. `/health` y la web compilada no miran esas cabeceras.
- **`status`** deja de decir qué app llama. `PROTOCOL` no sube.
- Fuera de `platform`: las llaves, el comando `keys` con su entrada en el bundle de `api` y su script, los mandatos, la lista fija de apps, las opciones `apps` y `mandateLife`, el barrido de los mandatos en la limpieza, la revocación de llaves y el borrado de mandatos al restaurar, y la comprobación de Better Auth que rechazaba una llave o un mandato.
- Fuera de `@domus/platform/contracts`: las constantes de la cabecera de la llave, su esquema y la del mandato, y el campo `app` de `status`.
- Fuera de las pruebas: `test.mandate`, `test.prepare.key`, `test.keys`, `test.revokeKey`, la opción `apps`, y las pruebas que solo probaban el mecanismo.
- **Gitleaks:** fuera la regla de las llaves; el escaneo sigue con las reglas por defecto, y su prueba comprueba con el ejecutable real que la configuración carga y que una muestra genérica activa una regla.
- Las tablas de las llaves y de los mandatos siguen en el esquema, sin código que las use, hasta la migración de la 05.

## Criterios de aceptación

- [x] `Authorization` con `Bearer`, con otro esquema y vacía, y la cabecera del mandato, cada una sola y junto a la cookie de `browser()`, dan `UNAUTHORIZED` en una acción de `probe`, en una operación de la plataforma, en `status`, en subir y descargar archivos, en el canal en directo y en iniciar y cerrar sesión, cada una con su formato.
- [x] Ni el valor de `Authorization` ni el del mandato aparecen en una respuesta de error ni en el log.
- [x] Sin esas cabeceras, `status` responde sin app, y una sesión normal funciona como antes.
- [x] Las pruebas de `apps/api` comprueban que `/health` y la web compilada responden igual con esas cabeceras.
- [x] La limpieza y restaurar siguen pasando sus pruebas sin el barrido ni la revocación.
- [x] La prueba de gitleaks caza la muestra genérica con el ejecutable real.
- [x] Nada fuera de los ADR, la spec y la migración vieja nombra llaves, mandatos o apps conectadas como vigentes; `packages/AGENTS.md`, `docs/agents/packages.md` y `CODING_STANDARDS.md` quedan al día.
- [x] `pnpm check` pasa.

## Comments

- Hecho en el commit «feat(platform): retire the keys and the mandates of the connected apps».
- La puerta (`platform/http/index.ts`) rechaza con un solo middleware sobre `/api/*` (`retiredHeaderOf`, con `authorization` y `domus-mandate`), antes de leer la cookie. Las rutas de Better Auth reciben `{ code, message }`, como su contraseña mala; las de Hono, el JSON de `errorResponse`; en `/api/rpc/*` el middleware deja pasar y un interceptor del `RPCHandler` lanza `UNAUTHORIZED` con `context.retired`, antes de buscar el procedimiento, para que la respuesta lleve el sobre de oRPC. Por eso un procedimiento o una ruta que no existe responde también 401 con esas cabeceras, no 404.
- El log del operador sigue: `retired credential refused: <cabecera>`, sin el valor (`http.test.ts`). Lo añado a la spec, «La puerta».
- Sale también `KIRA` de `@domus/platform/contracts`, que solo usaba `keys.ts`; `via` sigue con el valor `kira`, que no sale de ninguna constante.
- Las pruebas de la puerta están en `modules/probe/tests/retired-credentials.test.ts`: cada credencial (`Bearer`, `Basic`, `Authorization` vacía, el mandato), sola y junto a la cookie de `browser()`, en `status`, `probe.listNotes`, `probe.addNote`, `sessions/list`, `log/read`, subir, descargar, el canal en directo, iniciar y cerrar sesión. Las rutas de Hono se comparan con la respuesta sin credencial; sin cookie no se distinguen de ella, así que la variante con cookie es la que prueba que se rechaza antes de leer la sesión. `/health` y la web compilada, en `apps/api/src/app.test.ts`.
- Salen las pruebas del mecanismo: `keys-http`, `mandates-http`, `platform-mandates-http`, `mandate-end`, `restore-keys`, `identity/keys`, `keys-command`, `mandates`, el barrido de los mandatos en las dos de la limpieza, `runAccounts` con mandatos, la vida del mandato en `platform.test.ts`, y en `migrator.test.ts` las dos que llevaban llaves y mandatos a una base de la 1d4 (las tablas siguen, pero nada las lee).
- `gitleaks.test.ts`: la configuración carga y no marca un fichero limpio, un token de GitHub activa `github-pat` solo y dentro de una línea, y una copia rota de la configuración hace fallar a gitleaks, para que «carga» signifique algo.
- Las tablas `platform_keys` y `platform_mandates` siguen en `schema.ts`, con un comentario que dice que nada las usa, hasta la 05. Sin migración nueva.
- «Nada nombra llaves, mandatos o apps conectadas como vigentes» vale aquí, como en la 02, para el código, la configuración y las reglas para agentes (`packages/AGENTS.md`, `apps/AGENTS.md`, `docs/agents/packages.md`, `CODING_STANDARDS.md`, que generaliza «Credentials combine» a un contexto con `via`). `GLOSSARY.md`, la guía, `despliegue.md`, el README de arquitectura y el plan siguen nombrándolos: son de la 06, porque la Pi guarda la llave hasta entonces.

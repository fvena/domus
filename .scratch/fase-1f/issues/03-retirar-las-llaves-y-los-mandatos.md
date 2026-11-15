# 03. Retirar las llaves y los mandatos

Status: ready-for-agent
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

- [ ] `Authorization` con `Bearer`, con otro esquema y vacía, y la cabecera del mandato, cada una sola y junto a la cookie de `browser()`, dan `UNAUTHORIZED` en una acción de `probe`, en una operación de la plataforma, en `status`, en subir y descargar archivos, en el canal en directo y en iniciar y cerrar sesión, cada una con su formato.
- [ ] Ni el valor de `Authorization` ni el del mandato aparecen en una respuesta de error ni en el log.
- [ ] Sin esas cabeceras, `status` responde sin app, y una sesión normal funciona como antes.
- [ ] Las pruebas de `apps/api` comprueban que `/health` y la web compilada responden igual con esas cabeceras.
- [ ] La limpieza y restaurar siguen pasando sus pruebas sin el barrido ni la revocación.
- [ ] La prueba de gitleaks caza la muestra genérica con el ejecutable real.
- [ ] Nada fuera de los ADR, la spec y la migración vieja nombra llaves, mandatos o apps conectadas como vigentes; `packages/AGENTS.md`, `docs/agents/packages.md` y `CODING_STANDARDS.md` quedan al día.
- [ ] `pnpm check` pasa.

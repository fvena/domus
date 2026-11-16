# Los programas y cómo hablan

## Qué es

Domus funciona con un solo programa, api, y una web que el propio api entrega al navegador. Aquí se explica qué hace api hoy y cómo sabe la web, o cualquiera que le pregunte, si los dos usan la misma versión.

## Cómo funciona

Al arrancar, api abre la base de datos, la pone al día y abre la puerta. A cualquiera le contesta a dos preguntas: si sigue vivo, y quién es y qué versión habla. A la segunda responde «domus, protocolo 1». También deja entrar con una cuenta. Todo lo demás lo atiende solo a quien ya ha entrado: las acciones de los módulos y las operaciones de la propia plataforma, como ver tus sesiones o cambiar tu contraseña. Y entrega la web, que hoy es una página con el nombre de Domus.

La primera pregunta es la comprobación de salud. Docker la hace cada medio minuto, y si api deja de contestar, lo da por enfermo. Cuando se le pide parar, api cierra sus conexiones antes de salir.

## Por qué es así

Todo entra por api, y api es el único que toca los datos, así que hay un solo sitio que vigilar.

Lo de la versión viene de pensar en las actualizaciones. Si api se actualiza y quien le habla no, podrían hablarse sin entenderse; con la versión, el que se ha quedado atrás lo sabe antes de pedir nada.

## En el código

- api: `apps/api/src/main.ts` arranca la plataforma, la puerta y el servidor; `app.ts` monta la puerta y la web; `config.ts` lee `PORT`, `DOMUS_WEB_DIR`, `DOMUS_DATA_DIR`, `DOMUS_AUTH_SECRET` y `DOMUS_ORIGINS`; `accounts.ts` es el comando de las cuentas ([Las cuentas y las sesiones](cuentas.md)).
- La puerta: `createHttpHandler` en `packages/platform/http`, con oRPC sobre Hono. Responde `GET /health`, con el estado del [segundo plano](segundo-plano.md) en `background`, y `POST /api/rpc/status` sin sesión; con sesión, cada acción en `/api/rpc/<módulo>/<acción>` y las operaciones de `platformContract`. Better Auth atiende `/api/auth/sign-in/email` y `/sign-out`. El contrato de `status` y `PROTOCOL` están en `packages/platform/contracts`.
- Salud y parada: el `HEALTHCHECK` de `docker/Dockerfile` pide `/health`, y `readPort` y `onShutdown` están en `packages/utils/program`.
- Cliente: `clientFor(contrato, transporte)` en `packages/api-client`.
- Web: `apps/web`, en Vue. En desarrollo la sirve Vite; en Docker, api desde `DOMUS_WEB_DIR`.
- Arrancar en local: `pnpm dev` (todo en modo desarrollo) o `docker compose up -d --build`.
- Decisiones: [ADR 0003](../architecture/adr/0003-procesos-y-contenedores.md), [ADR 0004](../architecture/adr/0004-una-sola-puerta.md), [ADR 0020](../architecture/adr/0020-composicion-de-la-api-y-comunicacion-entre-procesos.md) y [ADR 0034](../architecture/adr/0034-retirar-las-apps-conectadas-antes-de-la-fase-5.md).

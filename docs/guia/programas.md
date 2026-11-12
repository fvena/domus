# Los programas y cómo hablan

## Qué es

Domus funciona con tres programas (api, assistant y voice-gateway) y una web. Aquí se explica qué hace cada uno hoy y cómo sabe cada programa si puede contar con los demás.

## Cómo funciona

api arranca el primero. Abre la base de datos, la pone al día y abre la puerta. A cualquiera le contesta a dos preguntas: si sigue vivo, y quién es y qué versión habla. A la segunda responde «domus, protocolo 1». También deja entrar con una cuenta. Todo lo demás lo atiende solo a quien ya ha entrado: las acciones de los módulos y las operaciones de la propia plataforma, como ver tus sesiones o cambiar tu contraseña. Y entrega la web, que hoy es una página con el nombre de Domus.

assistant y voice-gateway hacen ahora mismo lo mismo. Al arrancar le preguntan a api quién es y, según lo que oigan, se quedan en uno de tres estados. Si api no contesta, están conectando y vuelven a probar al segundo, a los dos, a los cuatro, y así hasta probar cada medio minuto. Si contesta y habla su misma versión, están listos. Si contesta en otra versión, son incompatibles y se quedan quietos hasta que las versiones coincidan.

Cuando ya han conectado siguen preguntando cada medio minuto, por si algo cambia. Nada que dependa de api se pone en marcha mientras no estén listos.

Los tres programas responden además a una comprobación de salud, para que el sistema sepa si siguen vivos, y cuando se les pide parar cierran sus conexiones antes de salir.

## Por qué es así

Separamos los programas para que un fallo en uno no tumbe a los demás. Si la voz se cuelga, la puerta y los datos siguen en pie.

Todo entra por api, y api es el único que toca los datos, así que hay un solo sitio que vigilar.

Lo de la versión viene de pensar en las actualizaciones. Si un programa se actualiza y otro no, podrían hablarse sin entenderse; con la versión, el que se ha quedado atrás lo sabe y espera.

## En el código

- api: `apps/api/src/main.ts` arranca la plataforma, la puerta y el servidor; `app.ts` monta la puerta y la web; `config.ts` lee `PORT`, `DOMUS_WEB_DIR`, `DOMUS_DATA_DIR`, `DOMUS_AUTH_SECRET` y `DOMUS_ORIGINS`; `accounts.ts` es el comando de las cuentas.
- La puerta: `createHttpHandler` en `packages/platform/http`, con oRPC sobre Hono. Responde `GET /health`, con el estado del [segundo plano](segundo-plano.md) en `background`, y `POST /api/rpc/status` sin sesión; con sesión, cada acción en `/api/rpc/<módulo>/<acción>` y las operaciones de `platformContract`. Better Auth atiende `/api/auth/sign-in/email` y `/sign-out`. El contrato de `status` y `PROTOCOL` están en `packages/platform/contracts`.
- assistant y voice-gateway: `apps/<programa>/src/main.ts` y `api.ts` (`checkApi`). Leen `DOMUS_API_URL`. Los estados los lleva `watchConnection` de `packages/utils/connection`, con reintentos de 1 a 30 s, una comprobación cada 30 s y 10 s de límite por pregunta.
- Salud y parada: `serveHealth` y `onShutdown` en `packages/utils/program`.
- Cliente: `clientFor(contrato, transporte)` en `packages/api-client`.
- Web: `apps/web`, en Vue. En desarrollo la sirve Vite; en Docker, api desde `DOMUS_WEB_DIR`.
- Arrancar en local: `pnpm dev` (todo en modo desarrollo) o `docker compose up -d --build`.
- Decisiones: [ADR 0003](../architecture/adr/0003-procesos-y-contenedores.md), [ADR 0004](../architecture/adr/0004-una-sola-puerta.md), [ADR 0005](../architecture/adr/0005-kira-aislada.md) y [ADR 0020](../architecture/adr/0020-composicion-de-la-api-y-comunicacion-entre-procesos.md).

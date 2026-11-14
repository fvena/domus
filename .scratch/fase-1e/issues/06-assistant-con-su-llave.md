# 06. `assistant` con su llave

Status: resolved
Blocked by: 02, 03

Spec: [`../spec.md`](../spec.md), sección «`status` y la conexión de `assistant`». ADR 0030 y ADR 0020.

## Qué construir

`assistant` arranca con su llave y sabe si la api la acepta. Sin llave, con una mala o con la de otra app, queda en rechazado, vivo, y lo dice en su log. Con la suya, llega a listo.

- **`@domus/utils/connection`**: `CheckResult` y el estado ganan `rejected`. En rechazado no se ejecuta nada que dependa de la api, se vuelve a comprobar cada 30 s y se sale de ahí cuando cambia la respuesta. El proceso sigue vivo y su `/health` no cambia.
- **`checkApi`** manda la llave en `status` y es `ready` solo si el protocolo coincide y la respuesta trae `app: "kira"`. Sin `app`, con otra app o con `UNAUTHORIZED`, es `rejected`. Un protocolo distinto es `incompatible`.
- **La configuración**: `DOMUS_API_KEY_FILE`, por defecto `/run/secrets/kira-key`, se lee una sola vez al arrancar. Si el fichero falta, está vacío o no se puede leer, arranca sin llave. El log nunca muestra la llave. Cambiar el fichero obliga a recrear el contenedor; la 1e no recarga el secreto en caliente.
- **Compose**: el secreto `kira-key` en `assistant` desde el fichero que dice `DOMUS_KIRA_KEY`, obligatorio como `DOMUS_BACKUP_PASSWORD`. La CI de contenedores usa un fichero vacío. `.env.local.example` apunta `DOMUS_API_KEY_FILE` a `data/kira-key` y dice cómo crearlo con `pnpm keys create kira > data/kira-key`.
- **El criterio del ADR 0020**: el mismo `clientFor` de `assistant`, contra la puerta en proceso, ejecuta una acción de `probe` con su llave y un mandato de prueba, y da `UNAUTHORIZED` sin llave.

La máquina de estados, la configuración y `checkApi` solo dependen de la 02 y se pueden adelantar mientras se hace la 03. La tarea se da por terminada con la prueba del criterio del ADR 0020, que necesita la 03.

## Criterios de aceptación

- [x] Con respuestas programadas, `rejected` se mantiene y vuelve a comprobar cada 30 s, y pasa a `ready` cuando la misma comprobación empieza a ser aceptada, sin reiniciar la vigilancia.
- [x] Las transiciones de siempre (conectando, listo, incompatible, el límite de 10 s) siguen como estaban.
- [x] Contra la puerta en proceso, `checkApi` da `rejected` sin llave, con una llave mala y con la de una app de prueba, y `ready` con la de `kira`. Nunca da `ready` cuando `status` responde bien sin acreditar a `kira`.
- [x] La configuración da una llave con el fichero presente, y ninguna con el fichero ausente o vacío, sin pararse y sin imprimir la llave.
- [x] El mismo `clientFor` y el mismo transporte que usa `assistant` ejecutan una acción de `probe` con llave y mandato, y sin la llave dan `UNAUTHORIZED`.
- [x] `docker compose config` falla sin `DOMUS_KIRA_KEY`, y la prueba de la CI de contenedores sigue arrancando los tres programas sanos.
- [x] `pnpm check` pasa.

## Comments

- Hecho en `a67a778`.
- `assistant` tiene un solo cliente, `apiClient(contrato, acceso, mandato?)` de `apps/assistant/src/api.ts`, con la llave en `Authorization` y el mandato opcional en `domus-mandate`; `checkApi` lo usa. La 5a debería llamar por él y no montar otro transporte. `api-client` no cambia; `assistant` gana `@orpc/client` (para reconocer `UNAUTHORIZED` con `ORPCError`) y `@orpc/contract` (los tipos del cliente).
- El criterio del ADR 0020 está en `tooling/scripts/assistant-acts.test.ts`, no en las pruebas de `assistant`: estas no pueden importar `probe` (`assistant-and-voice-gateway-only-talk-to-api`) y `probe` no puede importar una app (`nothing-imports-an-app`). `tooling` ya compone módulos reales, así que las reglas no cambian; `@domus/scripts` gana `@domus/probe` y `@domus/test-utils` como dependencias de desarrollo.
- La configuración quita los espacios y el salto de línea de los extremos del fichero, porque `keys create kira > fichero` deja uno. La prueba de «no se puede leer» usa una carpeta en lugar de un fichero `000`, que como root sí se leería.
- En `pnpm dev`, `apps/assistant/src/dev.ts` resuelve un `DOMUS_API_KEY_FILE` relativo desde la raíz del repositorio, como hace `dev-env` de `api` con `data`. Probado a mano con `pnpm keys create kira`: sin fichero, con una llave mala y con la buena.
- El log de rechazado nombra el fichero y dice si faltaba la llave o si la api no acepta la que hay, y que hay que arrancar `assistant` otra vez (en Docker, recrear el contenedor). Nunca repite la llave.
- Comprobado en local como la CI, con otro proyecto de compose: con el fichero vacío los tres arrancan sanos y `assistant` queda en rechazado; con `node /app/keys.mjs create kira` y `up -d --force-recreate assistant`, queda listo. La CI crea el fichero vacío con 600 y dueño 1000, como la contraseña de las copias.
- Quedan para la 08: los `AGENTS.md` de `apps` y `packages` (siguen diciendo «connecting, ready or incompatible»), el README de arquitectura, la guía (`docs/guia/programas.md`) y `despliegue.md`. `voice-gateway` no cambia: su llave es de la 5c.

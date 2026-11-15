# 02. Retirar `assistant`, `voice-gateway` y `utils/connection`

Status: resolved
Blocked by: —

Spec: [`../spec.md`](../spec.md), secciones «Qué sale y qué queda» y «Herramientas, Docker y CI», y costura 3. ADR 0034.

## Qué construir

Domus queda con un solo programa, `api`, además de la web. Los dos programas que solo comprobaban su conexión con la api desaparecen con todo lo que existía por ellos.

- Fuera `apps/assistant`, `apps/voice-gateway` y el tema `connection` de `@domus/utils`. El tema `program` se queda.
- Fuera las reglas de dependencias que solo existían por los dos programas, con sus casos en `architecture.test.ts`.
- Fuera de `docker-compose.yml` los servicios `assistant` y `voice-gateway` y el secreto `kira-key`; del `Dockerfile`, sus destinos; de `.env.local.example`, `DOMUS_API_URL` y `DOMUS_API_KEY_FILE`; de la CI, su matriz de build y la clave vacía de Kira.
- Fuera `tooling/scripts/assistant-acts.test.ts`.
- La llave y el mandato siguen en la plataforma; los retira la 03.

## Criterios de aceptación

- [x] `pnpm install`, `pnpm build` y `pnpm check` pasan sin los dos programas ni el tema `connection`.
- [x] `architecture.test.ts` prueba que salta cada regla que queda.
- [x] `compose-ci.test.ts` comprueba que la composición solo tiene `api`, y la CI solo construye y arranca `api`.
- [x] `docker compose up -d --build` en local arranca solo `api`.
- [x] Nada del repositorio, fuera de los ADR y de la spec, nombra a `apps/assistant`, `apps/voice-gateway` o `@domus/utils/connection` como vigentes.
- [x] `apps/AGENTS.md`, `packages/AGENTS.md` y `docs/agents/packages.md` quedan sin lo retirado.

## Comments

- Hecho en el commit «feat: retire assistant, voice-gateway and utils/connection».
- `compose-ci.test.ts` comprueba ahora que la composición solo tiene el servicio `api` y el secreto `backup-password`, que la CI construye exactamente los destinos que arranca la composición, y que el trabajo `containers` no da variables que la composición no lea. `docker compose up -d --build --wait` en local, con otro proyecto, arrancó solo `api`, sano.
- La regla `programs-never-reach-platform` se queda para `web`, con el nombre `web-never-reaches-platform`: era la única que seguía la cadena de imports de la web. `assistant-and-voice-gateway-only-talk-to-api` sale entera.
- Del tema `program` salen también `readUrl` y el servidor de `/health` (`createHealthApp`, `serveHealth`), que solo usaban los dos programas, y con ellos `hono` y `@hono/node-server` de `@domus/utils`. Quedan `readPort` y `onShutdown`, que usa `api`. Está en la spec («Herramientas, Docker y CI»).
- `.env.local.example` no tenía `DOMUS_KIRA_KEY`, que solo está en el `.env` de la Pi (la 06): salen `DOMUS_API_URL` y `DOMUS_API_KEY_FILE`, las variables locales de los dos programas. Corregido en la spec y en este ticket.
- Sale también la duplicación aceptada de `checkApi` en `CODING_STANDARDS.md`, que era de los dos programas.
- «Nada nombra a los programas como vigentes» vale para el código, la configuración y las reglas para agentes. `docs/despliegue.md`, la guía, el README de arquitectura y el plan siguen nombrándolos: la spec («Notas») se los da a la 06, que los pone al día al desplegar, porque la Pi sigue corriendo los dos contenedores hasta entonces. `keys-command.test.ts` usa `voice-gateway` como nombre de una app que no existe; sale con las llaves en la 03.

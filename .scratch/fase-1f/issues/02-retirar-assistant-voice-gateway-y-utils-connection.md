# 02. Retirar `assistant`, `voice-gateway` y `utils/connection`

Status: ready-for-agent
Blocked by: —

Spec: [`../spec.md`](../spec.md), secciones «Qué sale y qué queda» y «Herramientas, Docker y CI», y costura 3. ADR 0034.

## Qué construir

Domus queda con un solo programa, `api`, además de la web. Los dos programas que solo comprobaban su conexión con la api desaparecen con todo lo que existía por ellos.

- Fuera `apps/assistant`, `apps/voice-gateway` y el tema `connection` de `@domus/utils`. El tema `program` se queda.
- Fuera las reglas de dependencias que solo existían por los dos programas, con sus casos en `architecture.test.ts`.
- Fuera de `docker-compose.yml` los servicios `assistant` y `voice-gateway` y el secreto `kira-key`; del `Dockerfile`, sus destinos; de `.env.local.example`, `DOMUS_KIRA_KEY`; de la CI, su matriz de build y la clave vacía de Kira.
- Fuera `tooling/scripts/assistant-acts.test.ts`.
- La llave y el mandato siguen en la plataforma; los retira la 03.

## Criterios de aceptación

- [ ] `pnpm install`, `pnpm build` y `pnpm check` pasan sin los dos programas ni el tema `connection`.
- [ ] `architecture.test.ts` prueba que salta cada regla que queda.
- [ ] `compose-ci.test.ts` comprueba que la composición solo tiene `api`, y la CI solo construye y arranca `api`.
- [ ] `docker compose up -d --build` en local arranca solo `api`.
- [ ] Nada del repositorio, fuera de los ADR y de la spec, nombra a `apps/assistant`, `apps/voice-gateway` o `@domus/utils/connection` como vigentes.
- [ ] `apps/AGENTS.md`, `packages/AGENTS.md` y `docs/agents/packages.md` quedan sin lo retirado.

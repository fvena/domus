# Estructura del repositorio y reglas de dependencias

Un monorepo pnpm con Turborepo: `apps/` (api, web, assistant, voice-gateway), `modules/<módulo>/` (contracts, server, web, assistant, tests), `packages/` (platform, module-sdk, ui, i18n, utils, test-utils, api-client) y `tooling/` (la configuración de TypeScript compartida y las comprobaciones del repositorio). Cada paquete expone su código TypeScript desde `index.ts`; solo las apps se compilan. `api-client` es el cliente oRPC, con los tipos sacados del router: no se genera código. La forma de `module-sdk` se diseña en la fase 1a. El registro de módulos es una lista fija generada en el build, sin carga en tiempo de ejecución, tienda ni instalación. `utils` tiene un tema por carpeta, importado por separado (`@domus/utils/date-time`), y solo admite lo que no sabe nada del negocio y usan al menos dos sitios.

Las reglas se comprueban en `pnpm lint` con dependency-cruiser (`.dependency-cruiser.cjs`), y `tooling/scripts/architecture.test.ts` prueba que cada una salta. Así se leen:

- **Las apps son programas sin lógica de negocio:** nada importa una app, ninguna app usa directamente librerías de datos o de IA, `api` entra a cada módulo por su `server/index.ts` y `web` por su `web/index.ts`.
- **Un módulo importa solo `module-sdk` y los `contracts` de otros.** Además puede usar los paquetes que no saben del negocio: `utils` e `i18n`; en `web/`, también `ui` y `api-client`; en `tests/`, también `test-utils`. Los `contracts` de un módulo no importan sus otras partes, y `server/` y `web/` solo comparten los `contracts`.
- **`assistant` y `voice-gateway` solo hablan con `api`:** no importan `platform`, `module-sdk`, `ui` ni módulos.

Una regla rota se arregla cambiando la importación, nunca relajando la regla.

Fecha: 2026-11-11. Preguntas del grilling: P42b, P50b, P54.
Precisado por el ADR 0020: `web`, `assistant` y `voice-gateway` importan de `platform` solo sus contratos, y `api-client` no tiene contratos propios; el generador del registro de módulos llega en la fase 1a.
Precisado por el ADR 0021: la lista de módulos ya no se genera en el build; la escribe `pnpm modules:generate`, se guarda en git y una prueba comprueba que está al día. La forma de `module-sdk` en la 1a es `defineModule` con tablas con prefijo, sobre Drizzle.

# apps

Programs: configuration, wiring, the HTTP server, start and stop. Business logic lives in `modules/` and `packages/platform`, never here.

- `api`: mounts the door (`createHttpHandler` from `@domus/platform`) on `/health` and `/api/*`, and serves the built web app from `DOMUS_WEB_DIR`. The only program with the data volume.
- `web`: Vue SPA, no SSR. Talks to the api only through `@domus/api-client`.
- `assistant`: Kira, the part that thinks. Reaches Domus only over HTTP through the api (`DOMUS_API_URL`), with its one key; it mounts no data.
- `voice-gateway`: satellites, wake word, speech and who is speaking. Same HTTP-only rule as `assistant`.

`assistant` and `voice-gateway` take no requests but `/health` (`serveHealth` from `@domus/utils/program`); they call the api with `clientFor` and an injected `fetch` (`src/api.ts`); their tests pass the door in process from `@domus/test-utils`. At start they watch the api with `watchConnection`: connecting, ready or incompatible (another `PROTOCOL`). Anything that depends on the api runs only while `api.state` is `ready`.

Each server program reads its configuration at start (`src/config.ts`, with `readPort` and `readUrl`) and stops with a readable message when a value is missing. Each answers `GET /health`, which the Docker health check calls.

Server programs are bundled with esbuild into `dist/main.mjs`; in development `tsx watch` runs the TypeScript, with the variables of `.env.local`.

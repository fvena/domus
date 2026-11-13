# apps

Programs: configuration, wiring, the HTTP server, start and stop. Business logic lives in `modules/` and `packages/platform`, never here.

- `api`: opens the platform (`createPlatform`, `domus.db` in `DOMUS_DATA_DIR`, with the module list `src/modules.ts` that `pnpm modules:generate` writes, and the backups of `DOMUS_BACKUP_REPOSITORY` and `DOMUS_BACKUP_PASSWORD_FILE`: both or neither, off with neither or `DOMUS_BACKUPS_OFF=1`; the image sets both), mounts the door on `/health` and `/api/*`, and serves the built web app from `DOMUS_WEB_DIR`. `src/accounts.ts` wires `pnpm accounts` (in the container, `node /app/accounts.mjs`): the platform does the work, the file only asks for the secret without echo. `src/restore.ts` wires `pnpm restore` (in the container, `node /app/restore.mjs list` or `[--snapshot <id>]`, with api stopped): it reads `DOMUS_DATA_DIR` and both backup paths, whatever `DOMUS_BACKUPS_OFF` says, and the platform does the work. The only program with the data volume; `pnpm dev` puts it in `<repo>/data`.
- `web`: Vue SPA, no SSR. Talks to the api only through `@domus/api-client`.
- `assistant`: Kira, the part that thinks. Reaches Domus only over HTTP through the api (`DOMUS_API_URL`), with its one key; it mounts no data.
- `voice-gateway`: satellites, wake word, speech and who is speaking. Same HTTP-only rule as `assistant`.

`assistant` and `voice-gateway` take no requests but `/health` (`serveHealth` from `@domus/utils/program`); they call the api with `clientFor` and an injected `fetch` (`src/api.ts`); their tests pass the door in process from `@domus/test-utils`. At start they watch the api with `watchConnection`: connecting, ready or incompatible (another `PROTOCOL`). Anything that depends on the api runs only while `api.state` is `ready`.

Each server program reads its configuration at start (`src/config.ts`, with `readPort` and `readUrl`) and stops with a readable message when a value is missing. Each answers `GET /health`, which the Docker health check calls.

Server programs are bundled with esbuild into `dist/main.mjs`; in development `tsx watch` runs the TypeScript, with the variables of `.env.local`.

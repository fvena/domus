# 08. La puerta y `apps/api` componen `platform`

Status: resolved
Blocked by: 04, 07

Spec: [`../spec.md`](../spec.md), secciones «Base de datos» y «Composición».

`apps/api` abre la base de datos con la lista de módulos y se la da a la puerta, que no publica nada nuevo.

## Qué hacer

- `createHttpHandler({ platform, modules })` recibe las dos cosas. No añade rutas: `status` sigue siendo la única RPC. `createTestPlatform` pasa a la puerta su `platform` y sus módulos.
- `readConfig` lee `DOMUS_DATA_DIR`: exige una ruta absoluta y falla con un mensaje claro si falta o es relativa. El fichero es `<DOMUS_DATA_DIR>/domus.db`.
- El script `dev` de `apps/api` fija `DOMUS_DATA_DIR` en `<repo>/data` si no está definida, calculada desde la carpeta de la app, y crea la carpeta si no existe.
- `.env.local.example` documenta `DOMUS_DATA_DIR` comentada, para quien quiera otra ruta.
- `main.ts` compone: `createPlatform({ databaseFile, modules })` con la lista generada, la puerta y la web. Escribe en el log `database at <ruta>: <N> migrations applied`. El `onShutdown` existente cierra el servidor y después la `platform`.
- Si `createPlatform` falla, `api` termina con error sin abrir el puerto.

## Aceptación

- Pruebas de `readConfig`: ruta absoluta aceptada; ausente y relativa rechazadas.
- Prueba de la app sobre un fichero temporal: arranca, `/health` y `status` responden igual que antes, y ninguna otra ruta de `/api/rpc` responde.
- `pnpm dev` arranca en un clon limpio sin tocar `.env.local` y crea `data/domus.db`.
- Pasan `pnpm format:check`, `pnpm lint`, `pnpm type-check`, `pnpm test` y `pnpm build`.

## Comments

- Hecha en `971e5ca`.

# 10. La Pi y el cierre de la 1d3

Status: ready-for-agent
Blocked by: 01, 02, 03, 04, 05, 06, 07, 08, 09

Spec: [`../spec.md`](../spec.md), secciones «El ensayo y la comprobación en la Pi» y «Reglas y documentación», y «En la Pi» de «Decisiones de prueba». Plan, 1d3.

## Qué construir

La comprobación en la Pi y el cierre de la 1d3. Las órdenes que tiene que ejecutar una persona en la Pi se dan una a una, en español, y se anotan sus resultados en `despliegue.md`.

- **La imagen `domus-api:ensayo`**, con una composición explícita de módulos que incluye `probe` sin quitarle su `testOnly`. La lista de producción no cambia y su prueba sigue dejando fuera los módulos `testOnly`. Esta tarea decide cómo se elige la composición al construir.
- **En el Domus real**: una subida se prepara; un tipo no admitido y un exceso de tamaño se rechazan; el archivo preparado sin usar desaparece con la limpieza tras caducar; y la copia de esa noche sale bien.
- **En el ensayo**: se suben archivos, se vinculan a notas y una se borra con su deshacer vigente; tras copiar, vaciar solo el volumen de `domus-restore` y restaurar, las descargas coinciden por hash, deshacer recupera el archivo y los archivos preparados de la copia no sirven.
- **Documentación**: `despliegue.md` (el almacén, los límites, el ensayo con archivos y sus resultados), la guía (`docs/guia/`, con sus reglas y el `humanizer`), `packages/AGENTS.md` dentro de su límite, y el plan con la 1d3 hecha.

## Criterios de aceptación

- [ ] La imagen del ensayo incluye `probe` y la de producción no; las dos pruebas de la lista lo comprueban.
- [ ] En el Domus real, las cuatro comprobaciones salen bien y quedan anotadas.
- [ ] En el ensayo, base y archivos se restauran juntos, con los resultados anotados.
- [ ] `despliegue.md`, la guía, `packages/AGENTS.md` y el plan recogen lo construido.
- [ ] `pnpm check` pasa.

## Comments

- 2026-11-14, en la rama `chore/cierre-fase-1d3`:
    - **La imagen del ensayo.** `--build-arg DOMUS_MODULES=rehearsal` en `docker/Dockerfile` reescribe dentro de la imagen la lista de `apps/api` con `pnpm modules:generate --rehearsal`, que lleva también los módulos `testOnly`; sin el argumento, la imagen lleva la lista de git. `apps/api` gana `@domus/probe` como dependencia de desarrollo para que esa lista se resuelva al empaquetar. Pruebas en `tooling/scripts/module-list.test.ts`: la composición del ensayo importa los `testOnly`, y la lista real del ensayo importa `probe` mientras la de producción no. En la Pi, `domus-api:ensayo` llevó las acciones de `probe` en `main.mjs`, `restore.mjs` y `accounts.mjs`, y `domus-api:local`, ninguna.
    - **El Domus real**, con `main` en `5cd2a21` desplegado (`1 migrations applied`, `/health` `ok` con `backups: saved`, las rutas de archivos sin sesión `401`): `lista-compra.txt` se preparó (`200`) y su contenido quedó en `contents/ae/aec5…`, con el mismo SHA-256 que el original; el binario respondió `415 FILE_TYPE_NOT_ALLOWED`, los 26 MB `413 FILE_TOO_LARGE`, y sin sesión `401`. Ese archivo preparado caduca el 2026-11-15 a las 13:38: falta ver que la limpieza del 2026-11-16 a las 04:30 lo borra con su contenido, y que la copia del 2026-11-15 a las 05:00 sale bien.
    - **El ensayo**, con `domus-api:ensayo` sobre la copia real `d1dd591a…`: los resultados están en `docs/despliegue.md`, «Ensayar con archivos». Base y archivos se restauraron juntos desde la copia propia del ensayo, `8c402530`, tras vaciar solo `domus-restore_data`.
    - **Cómo se corrieron las órdenes.** Las de la persona fueron solo entrar (tres veces) y un comprobante, con dos ayudantes temporales en `~/.domus-cierre` de la Pi (`entrar.sh` y `comprobante.sh`, que guardaban la cookie y el comprobante en esa carpeta `700`); el resto lo corrió el agente por `ssh kira` con esa cookie. Son las mismas peticiones que las órdenes nuevas de `despliegue.md`, que usan la terminal de «Comprobar las cuentas y la autorización» con `$D`; los archivos de prueba se crearon con Python, y los `printf` y `head` del documento se comprobaron aparte con `detectFileType` (PNG, PDF y ninguno). La carpeta, las sesiones, el ensayo y su imagen se quitaron al terminar.

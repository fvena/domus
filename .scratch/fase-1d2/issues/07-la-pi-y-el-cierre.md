# 07. La Pi y el cierre de la 1d2

Status: ready-for-agent
Blocked by: 01, 02, 03, 04, 05, 06

Spec: [`../spec.md`](../spec.md), secciones «El ensayo y la medición en la Pi», «Decisiones de prueba» («En la Pi») y «Notas». ADR 0026.

## Qué construir

La 1d2 publicada en la Pi, ensayada y cerrada en los documentos.

- **El ensayo**: un fichero de compose del repositorio para el proyecto `domus-restore`, con su propio volumen de datos, `127.0.0.1:3001` sin Tailscale y `DOMUS_BACKUPS_OFF=1` en su `api`. El comando `restore` del ensayo monta el repositorio de producción con escritura y restaura con el bloqueo compartido de restic y `--retry-lock 30m`; la `api` del ensayo nunca lo monta.
- **La medición**: el ensayo, con su propio repositorio desechable y su propia contraseña y las copias encendidas, y un script de medición del repositorio que corre con el Node de la imagen. Llena la base hasta unos 500 MB con entradas sintéticas del registro de acciones; durante una medición base y tres copias enteras lanzadas con `tasks/launch`, pide a cadencia fija, sin esperar a la respuesta anterior, `/health` y una lectura con sesión cada 100 ms, y una escritura real por segundo: pedir un comprobante. Anota la duración de cada fase y los percentiles. Si aparece un límite de frecuencia en esa escritura, se cambia en la spec antes de seguir.
- **En la Pi**: el directorio `/srv/backups/domus` y el fichero de la contraseña (permisos 600, legible por el uid 1000, guardado también en el gestor de contraseñas), el `.env` con `DOMUS_BACKUPS` y `DOMUS_BACKUP_PASSWORD`, la copia a su hora y el ensayo.
- **`docs/despliegue.md`**, escrito a medida que se ejecutan los comandos: el repositorio y su contraseña, el `.env`, el estado de copias de `/health`, listar y restaurar, retomar tras un corte, las carpetas `before-restore` (cómo devolver una y cuándo borrarla), qué vuelve con la copia (contraseñas, permisos, delegación, ajustes de las tareas) y qué se pierde (claves de idempotencia posteriores), el ensayo y la medición con su resultado. Sustituye «no borres el volumen».
- **`docs/plan.md`** marca la 1d2 como hecha, con la fecha.
- **`docs/guia/`** recoge lo construido, según `docs/AGENTS.md`, revisado con la skill `humanizer`.
- **El `AGENTS.md` raíz**: restic como requisito junto a gitleaks y `pnpm restore` en la tabla, dentro de su límite de líneas.
- **Arquitectura, glosario y ADR 0026**: se corrigen solo si la implementación los contradijo; la spec, si la medición cambia algún valor inicial.

Los pasos que piden contraseña o `sudo` los hace la persona, en español y paso a paso (`docs/agents/workflow.md`).

## Criterios de aceptación

- [ ] En la Pi, el uid 1000 escribe en `/srv/backups/domus` y lee el secreto.
- [ ] La copia corre a su hora en la Pi o, para no esperar, la lanza el admin a mano; `/health` pasa de `none-yet` a `saved` y la lista de tareas muestra el resultado.
- [ ] El ensayo restaura en `domus-restore` la última copia de producción sin chocar con su retención, entra una sesión nueva y se ven los datos.
- [ ] La medición está hecha y anotada: ninguna respuesta pasa de 500 ms ni da error, o la spec recoge qué se cambia.
- [ ] `despliegue.md`, `plan.md`, la guía y el `AGENTS.md` raíz están al día.

## Comments

- La primera medición en la Pi, con una base de unos 500 MB, encontró un parón de 1,1 a 1,4 s en cada copia: todas las peticiones esperaban a la vez, sin errores. Al terminar, `db.backup()` forzaba a disco el fichero de destino de una vez, en el único hilo de `api`. El ADR 0027 saca la instantánea a un proceso hijo con su propia conexión, que toma el cerrojo compartido y hace `VACUUM INTO`; el instante de captura pasa a ser el de antes de empezar la copia. Hecho en `4871529`. Una copia que el hijo no termina bien falla ahora sin reintentos (`the snapshot could not be taken`), y las pruebas detienen el hijo en su copia con `fakeNode`. Falta repetir la medición, con el mismo umbral de 500 ms y las tres copias enteras.

# La Pi y el despliegue

## Qué es

Domus vive en una Raspberry Pi 5 que tenemos en casa y que se llama kira. Aquí se cuenta cómo está montada y cómo le llegan los cambios.

## Cómo funciona

La Pi tiene una copia del código de la rama principal. Para actualizarla, se trae lo último y se reconstruyen los contenedores allí mismo, cosa que tarda unos 30 segundos. A la Pi solo llega lo que ya ha pasado las comprobaciones y la revisión.

Los tres programas arrancan cuando arranca la Pi y vuelven solos si se caen o se va la luz. assistant y voice-gateway esperan a que api esté sano antes de ponerse en marcha. Con api arranca también el planificador, que lanza la limpieza y la copia de seguridad de cada noche, y al parar api espera a que termine lo que estaba corriendo.

Los datos están en un volumen, un trozo de disco que no pertenece a ningún contenedor. Por eso el contenedor de api se puede reconstruir o cambiar por otro sin tocar los datos. Lo comprobamos en la propia Pi: después de reiniciar api y después de recrearlo desde cero, la base de datos seguía exactamente igual, y la hora de la limpieza y su próxima ejecución también.

En casa se entra por `kira.local`, y desde fuera, por Tailscale.

Las copias de seguridad se guardan en otra carpeta del mismo disco de la Pi, fuera del volumen de datos, cifradas. Su contraseña está en un fichero de la Pi y también en el gestor de contraseñas de casa, porque sin ella las copias no sirven. Restaurar una copia se hace también en la Pi, con api parada. Para no estrenarlo el día que haga falta, lo ensayamos en un segundo Domus que corre al lado del real, con sus propios datos, y que se quita al terminar.

Las cuentas se crean en la propia Pi, con un comando dentro del contenedor de api. La clave que firma las sesiones está en un fichero de la Pi que no viaja con el código, y sin ella api no arranca. Lo mismo pasa con la contraseña de las copias.

## Por qué es así

Queremos que un corte de luz no obligue a nadie a tocar nada, así que los programas se levantan solos.

Los datos van aparte porque en cada actualización el contenedor se tira y se vuelve a hacer, y lo que guarda la casa tiene que sobrevivir a eso. Las copias van fuera del volumen para que borrarlo por error no se las lleve también.

## En el código

- El manual con los pasos para actualizar y comprobar: [`docs/despliegue.md`](../despliegue.md).
- Imágenes: `docker/Dockerfile`, con un destino por programa sobre Debian slim. La imagen de api lleva el binario de SQLite de su arquitectura (arm64 en la Pi).
- Arranque: `docker-compose.yml`, con `restart: unless-stopped` y assistant y voice-gateway esperando a que api esté `healthy`.
- Acceso: `ssh kira`. El volumen de datos es `domus_domus-data` y los secretos, `~/domus/.env`.
- Copias: el repositorio de restic en `/srv/backups/domus` y su contraseña en `~/.config/domus/backup-password`, los dos del uid 1000. Restaurar: `docker compose run --rm --no-deps --entrypoint node api /app/restore.mjs`. El ensayo: `docker/ensayo/compose.yml` ([Las copias de seguridad y restaurar](copias.md)).
- Cuentas: `docker compose exec api node /app/accounts.mjs create …`.
- El segundo plano en la Pi: el log de api dice `scheduler started` y `scheduler stopped`, y `curl -s localhost:3000/health` dice `"background":{"status":"ok","backups":"saved"}` ([El trabajo en segundo plano](segundo-plano.md)).
- Decisiones: [ADR 0003](../architecture/adr/0003-procesos-y-contenedores.md), [ADR 0021](../architecture/adr/0021-datos-de-los-modulos-y-migraciones.md) y [ADR 0023](../architecture/adr/0023-identidad-y-autorizacion.md).

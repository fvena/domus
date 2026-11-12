# La Pi y el despliegue

## Qué es

Domus vive en una Raspberry Pi 5 que tenemos en casa y que se llama kira. Aquí se cuenta cómo está montada y cómo le llegan los cambios.

## Cómo funciona

La Pi tiene una copia del código de la rama principal. Para actualizarla, se trae lo último y se reconstruyen los contenedores allí mismo, cosa que tarda unos 30 segundos. A la Pi solo llega lo que ya ha pasado las comprobaciones y la revisión.

Los tres programas arrancan cuando arranca la Pi y vuelven solos si se caen o se va la luz. assistant y voice-gateway esperan a que api esté sano antes de ponerse en marcha.

Los datos están en un volumen, un trozo de disco que no pertenece a ningún contenedor. Por eso el contenedor de api se puede reconstruir o cambiar por otro sin tocar los datos. Lo comprobamos en la propia Pi: después de reiniciar api y después de recrearlo desde cero, la base de datos seguía exactamente igual.

En casa se entra por `kira.local`, y desde fuera, por Tailscale.

## Por qué es así

Queremos que un corte de luz no obligue a nadie a tocar nada, así que los programas se levantan solos.

Los datos van aparte porque en cada actualización el contenedor se tira y se vuelve a hacer, y lo que guarda la casa tiene que sobrevivir a eso.

## En el código

- El manual con los pasos para actualizar y comprobar: [`docs/despliegue.md`](../despliegue.md).
- Imágenes: `docker/Dockerfile`, con un destino por programa sobre Debian slim. La imagen de api lleva el binario de SQLite de su arquitectura (arm64 en la Pi).
- Arranque: `docker-compose.yml`, con `restart: unless-stopped` y assistant y voice-gateway esperando a que api esté `healthy`.
- Acceso: `ssh kira`. El volumen de datos es `domus_domus-data`.
- Decisiones: [ADR 0003](../architecture/adr/0003-procesos-y-contenedores.md) y [ADR 0021](../architecture/adr/0021-datos-de-los-modulos-y-migraciones.md).

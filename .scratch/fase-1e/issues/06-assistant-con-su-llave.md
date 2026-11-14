# 06. `assistant` con su llave

Status: ready-for-agent
Blocked by: 02, 03

Spec: [`../spec.md`](../spec.md), sección «`status` y la conexión de `assistant`». ADR 0030 y ADR 0020.

## Qué construir

`assistant` arranca con su llave y sabe si la api la acepta. Sin llave, con una mala o con la de otra app, queda en rechazado, vivo, y lo dice en su log. Con la suya, llega a listo.

- **`@domus/utils/connection`**: `CheckResult` y el estado ganan `rejected`. En rechazado no se ejecuta nada que dependa de la api, se vuelve a comprobar cada 30 s y se sale de ahí cuando cambia la respuesta. El proceso sigue vivo y su `/health` no cambia.
- **`checkApi`** manda la llave en `status` y es `ready` solo si el protocolo coincide y la respuesta trae `app: "kira"`. Sin `app`, con otra app o con `UNAUTHORIZED`, es `rejected`. Un protocolo distinto es `incompatible`.
- **La configuración**: `DOMUS_API_KEY_FILE`, por defecto `/run/secrets/kira-key`, se lee una sola vez al arrancar. Si el fichero falta, está vacío o no se puede leer, arranca sin llave. El log nunca muestra la llave. Cambiar el fichero obliga a recrear el contenedor; la 1e no recarga el secreto en caliente.
- **Compose**: el secreto `kira-key` en `assistant` desde el fichero que dice `DOMUS_KIRA_KEY`, obligatorio como `DOMUS_BACKUP_PASSWORD`. La CI de contenedores usa un fichero vacío. `.env.local.example` apunta `DOMUS_API_KEY_FILE` a `data/kira-key` y dice cómo crearlo con `pnpm keys create kira > data/kira-key`.
- **El criterio del ADR 0020**: el mismo `clientFor` de `assistant`, contra la puerta en proceso, ejecuta una acción de `probe` con su llave y un mandato de prueba, y da `UNAUTHORIZED` sin llave.

La máquina de estados, la configuración y `checkApi` solo dependen de la 02 y se pueden adelantar mientras se hace la 03. La tarea se da por terminada con la prueba del criterio del ADR 0020, que necesita la 03.

## Criterios de aceptación

- [ ] Con respuestas programadas, `rejected` se mantiene y vuelve a comprobar cada 30 s, y pasa a `ready` cuando la misma comprobación empieza a ser aceptada, sin reiniciar la vigilancia.
- [ ] Las transiciones de siempre (conectando, listo, incompatible, el límite de 10 s) siguen como estaban.
- [ ] Contra la puerta en proceso, `checkApi` da `rejected` sin llave, con una llave mala y con la de una app de prueba, y `ready` con la de `kira`. Nunca da `ready` cuando `status` responde bien sin acreditar a `kira`.
- [ ] La configuración da una llave con el fichero presente, y ninguna con el fichero ausente o vacío, sin pararse y sin imprimir la llave.
- [ ] El mismo `clientFor` y el mismo transporte que usa `assistant` ejecutan una acción de `probe` con llave y mandato, y sin la llave dan `UNAUTHORIZED`.
- [ ] `docker compose config` falla sin `DOMUS_KIRA_KEY`, y la prueba de la CI de contenedores sigue arrancando los tres programas sanos.
- [ ] `pnpm check` pasa.

# 10. La Pi y el cierre de la 1d4

Status: ready-for-agent
Blocked by: 01, 02, 03, 04, 05, 06, 07, 08, 09, y el cierre de la 1d3

Spec: [`../spec.md`](../spec.md), secciones «La comprobación en la Pi» y «Reglas y documentación». Plan, 1d4.

## Qué construir

La comprobación en la Pi y el cierre de la 1d4. La 1d3 tiene que estar cerrada antes: su copia del 2026-11-15 y su limpieza del 2026-11-16. Las órdenes que tiene que ejecutar una persona en la Pi se dan una a una, en español, y sus resultados se anotan en `despliegue.md`.

- **En el ensayo**, con `domus-api:ensayo`, por Tailscale (https), con dos cuentas y `curl` sobre `/api/events`: una nota pública nueva llega a las dos (se anota cuánto tarda; el objetivo nuevo es menos de 1 s), una privada solo a su dueño, el paso a privada llega al lector anterior, que al volver a pedirla ya no la ve, revocar una sesión cierra su canal con `purge`, y las claves VAPID son las mismas tras reiniciar y tras recrear `api`.
- **En el Domus real**: `/api/events` sin sesión responde `401` con `no-store`, y `GET /api/notifications/key` con sesión responde una clave.
- **Documentación**: `despliegue.md`, la guía (`docs/guia/`, con sus reglas y el `humanizer`), `packages/AGENTS.md` dentro de su límite, el plan con la 1d4 hecha, y comprobar que el ADR 0029, sus enlaces y el glosario (Suscripción, Entrega y Tabla de área) recogen lo que se construyó al final. Si la implementación cambió una decisión de la spec, se corrige allí también.

## Criterios de aceptación

- [ ] La 1d3 está cerrada en el plan.
- [x] En el ensayo, las cinco comprobaciones salen bien y quedan anotadas, con el tiempo medido de la nota pública.
- [x] En el Domus real, las dos comprobaciones salen bien y quedan anotadas.
- [x] `despliegue.md`, la guía, `packages/AGENTS.md`, el plan, el ADR 0029 y el glosario recogen lo construido.
- [ ] `pnpm check` pasa.

## Comments

- 2026-11-14, en la rama `chore/cierre-fase-1d4`:
    - **Desplegada antes de cerrar la 1d3, por decisión de Paco.** La 1d3 solo espera a ver su copia del 2026-11-15 y su limpieza del 2026-11-16. Esperar dejaba la 1d4 parada dos días, así que `main` en `3f13153` se desplegó el 2026-11-14 (`3 migrations applied`, los tres `healthy`, `/health` `ok` con `backups: saved`). Esa copia y esa limpieza corren ya con el código de la 1d4, que incluye el de la 1d3, y sirven de prueba para las dos. Esta tarea se cierra cuando la 1d3 salga bien.
    - **Antes de desplegar, la CI del PR fallaba**: el api se caía al arrancar porque `web-push`, en CommonJS, pide `crypto` y el bundle ESM de esbuild no tenía `require`. El arreglo (`5606e6d`) es un banner con `createRequire`, y el aprendizaje lo deja escrito.
    - **El Domus real:** `/api/events` y `/api/notifications/key` sin sesión, `401` con `no-store`, en la Pi y por Tailscale desde el Mac. Con sesión, la clave respondió `200` con `no-store`. El canal por Tailscale recibió `ready` a los 34 ms y el latido a los 25,0 s. Había 0 suscripciones y una fila de claves, creada a las 21:19.
    - **El ensayo**, con `domus-api:ensayo` sobre la copia real `d1dd591a…`, dentro de la Pi y no por Tailscale (decidido sin preguntar y anotado en la spec: sacarlo por Tailscale pedía cambiar `tailscale serve`, y el proxy ya se comprueba en el Domus real). Los resultados están en `docs/despliegue.md`, «Ensayar el canal en directo»: la nota pública llegó a Paco y a Rocío en 22 ms, la privada solo a Paco, el paso a privada llegó a Rocío y después `getNote` le devolvió `null`, revocar `paco2` le mandó `purge` en 16 ms y cerró su canal sin tocar los otros dos, y la huella de la clave VAPID fue la misma antes, tras `restart` y tras `--force-recreate`.
    - **Cómo se corrieron las órdenes.** La persona solo entró y pidió un comprobante. Entró cinco veces, porque la cuarta, que era para Rocío, usó el correo de Paco y hubo que repetirla con el suyo, con dos ayudantes temporales en `~/.domus-cierre` de la Pi (`entrar.sh` y `comprobante.sh`, carpeta `700`). El resto lo corrió el agente por `ssh kira` con esas cookies. Son las mismas peticiones que las órdenes nuevas de `despliegue.md`, salvo los nombres de las funciones. La de «Comprobar», sin sesión, se corrió tal cual. La carpeta, las sesiones, el ensayo y su imagen se quitaron al terminar.
    - **El ADR 0029 y el glosario**, comparados con lo construido: el ADR gana seis precisiones (`about` es `{ type, id }`; los cambios de archivos invalidan su registro; `reset` sale con cada `permissions/set`; el reparto también comprueba la sesión; las confirmaciones pendientes solo miran que su sesión exista; `Retry-After` solo en 429 y 503), y él y la Tabla de área del glosario dicen que una tabla de área nunca está en un área siempre privada.
    - Falta: ver el 2026-11-16 que la copia del 15 salió bien y que la limpieza borró `lista-compra.txt` con su contenido, cerrar la 1d3 en el plan y después la 1d4.

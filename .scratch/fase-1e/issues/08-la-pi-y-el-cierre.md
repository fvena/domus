# 08. La Pi y el cierre de la 1e

Status: ready-for-agent
Blocked by: 01, 02, 03, 04, 05, 06, 07, y el cierre de la 1d3 y la 1d4

Spec: [`../spec.md`](../spec.md), secciones «La comprobación en la Pi» y «Reglas y documentación». ADR 0030 y [`docs/despliegue.md`](../../../docs/despliegue.md).

## Qué construir

La llave de Kira en el Domus real de la Pi, con una rotación que funciona y otra que se recupera de un fallo, y la documentación al día.

- **`despliegue.md`**: crear la llave de Kira, el fichero del secreto y `DOMUS_KIRA_KEY`, la rotación con su vuelta atrás, y crear una llave nueva tras restaurar.
- **Los `AGENTS.md`** de `packages` y de `apps`, dentro de sus límites de tamaño.
- **La guía** (`docs/guia/`): las llaves y los mandatos entran en su tema de cuentas o de seguridad, con las reglas de `docs/AGENTS.md` y repasada con `humanizer`.
- **El plan**: la 1e, hecha y con su fecha.
- **La comprobación en la Pi**, ejecutada por ssh, sin `probe`.

## Criterios de aceptación

- [x] Con `~/.config/domus/kira-key` vacío, en una carpeta `700` y con `umask 077`, `assistant` queda en rechazado.
- [x] `docker compose exec -T api node /app/keys.mjs create kira > ~/.config/domus/kira-key.new` termina bien, y su contenido tiene la forma de una llave antes de moverlo sobre `kira-key`. Tras recrear `assistant`, queda listo.
- [x] `status` con una llave inventada responde 401.
- [x] Rotación correcta: una llave nueva a `.new`, la vieja copiada a `.old`, `mv` y `docker compose up -d --force-recreate assistant`. `assistant` queda listo, `keys list` muestra el último uso de la nueva, se revoca la vieja y se borra `.old`. La vieja responde 401.
- [x] Rotación fallida, comprobada aparte: con una llave inventada en lugar de la nueva, `assistant` queda en rechazado. Se vuelve a `.old`, se recrea `assistant` y queda listo.
- [x] `keys list` muestra la llave revocada y el último uso.
- [x] Tras reiniciar y tras recrear `api`, la llave sigue valiendo.
- [x] `despliegue.md`, los `AGENTS.md`, la guía y el plan recogen lo construido, y `pnpm check` pasa.

## Comments

- 2026-11-15, en la rama `chore/cierre-fase-1e`:
    - **Desplegada antes de cerrar la 1d3 y la 1d4, por decisión de Paco**, como la 1d4. La 1d3 ya vio su copia del 2026-11-15 y solo espera a su limpieza del 2026-11-16, que corre con el código de la 1e. Antes de desplegar se creó `~/.config/domus/kira-key` vacío (`600`, carpeta `700`, `umask 077`) y `DOMUS_KIRA_KEY` en `.env`, porque compose no arranca sin él. `main` en `c3a2e8a`: `2 migrations applied`, los tres `healthy`, `/health` `ok` con `backups: saved`.
    - **Lo comprobado**, todo por `ssh kira` y sin `probe`, anotado en `docs/despliegue.md`, «Las llaves»: con el fichero vacío, `assistant` en rechazado; la llave `J_8hwLv_DQM`, con su forma comprobada antes del `mv`, y `assistant` `ready`; `status` `401` con una llave inventada y `"app":"kira"` con la de Kira; la rotación a `T8qOLZuewtY`, con su último uso en `keys list`, y la vieja revocada y en `401`; la rotación fallida, en rechazado, y la vuelta a `.old`, `ready`; la llave tras `restart` y tras `--force-recreate` de `api`. Después, las órdenes de `despliegue.md` tal cual rotaron a `OL-PNggBriM`, la llave viva.
    - **Ninguna orden necesitó a la persona**: `keys` no pide contraseña ni terminal.
    - **El mensaje de rechazo** de `assistant` con una llave mala no decía qué hacer antes de «then start assistant again». Ahora dice que se ponga una viva, hecha con `keys create kira`.
    - **Los `AGENTS.md`** de `packages` y de `apps` ya recogían las llaves desde la revisión; `packages` gana que un comprobante solo cuenta por el canal `app`.
    - Falta: cerrar la 1d3 y la 1d4 en el plan, y después marcar la 1e como hecha.

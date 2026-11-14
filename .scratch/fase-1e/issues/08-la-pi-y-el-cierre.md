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

- [ ] Con `~/.config/domus/kira-key` vacío, en una carpeta `700` y con `umask 077`, `assistant` queda en rechazado.
- [ ] `docker compose exec -T api node /app/keys.mjs create kira > ~/.config/domus/kira-key.new` termina bien, y su contenido tiene la forma de una llave antes de moverlo sobre `kira-key`. Tras recrear `assistant`, queda listo.
- [ ] `status` con una llave inventada responde 401.
- [ ] Rotación correcta: una llave nueva a `.new`, la vieja copiada a `.old`, `mv` y `docker compose up -d --force-recreate assistant`. `assistant` queda listo, `keys list` muestra el último uso de la nueva, se revoca la vieja y se borra `.old`. La vieja responde 401.
- [ ] Rotación fallida, comprobada aparte: con una llave inventada en lugar de la nueva, `assistant` queda en rechazado. Se vuelve a `.old`, se recrea `assistant` y queda listo.
- [ ] `keys list` muestra la llave revocada y el último uso.
- [ ] Tras reiniciar y tras recrear `api`, la llave sigue valiendo.
- [ ] `despliegue.md`, los `AGENTS.md`, la guía y el plan recogen lo construido, y `pnpm check` pasa.

# 06. La Pi y el cierre

Status: ready-for-agent
Blocked by: 05

Spec: [`../spec.md`](../spec.md), secciones «La comprobación en la Pi» y «Reglas y documentación». ADR 0034.

## Qué construir

La 1f llega a la Pi, la Pi queda con solo `api`, y la documentación para personas cuenta lo que queda. La 1f se da por hecha cuando la copia de la primera noche sale bien.

- **En la Pi, en el Domus real, en este orden:** desplegar con `docker compose up -d --remove-orphans`; comprobar que solo corre `api`, la fila de la migración nueva, y que sigue igual tras reiniciar y tras recrear `api`; comprobar que `status` con un `Bearer` inventado da 401 y que una sesión normal entra y lee; borrar la carpeta del secreto de Kira y quitar `DOMUS_KIRA_KEY` de la configuración de la Pi; al día siguiente, comprobar la copia de esa noche. La persona solo teclea contraseñas.
- **Documentación:** `despliegue.md`, sin «Las llaves», sin las filas y los logs de los dos programas y sin la revocación de llaves al restaurar; la guía (`seguridad.md`, `permisos.md`, `programas.md`, `arquitectura.md`, `la-pi.md` y la portada), revisada con `humanizer`; el README de arquitectura, que deja de describir los programas y la llave como vigentes; el glosario, sin **Llave** ni **App conectada**, con **Agente conectado** sin definirse como app conectada, **Mandato** con el sentido del ADR 0032 y **Contexto verificado** sin «la conversación», que todavía lista; y el plan, con la 1f hecha.

## Criterios de aceptación

- [x] `docker compose ps` en la Pi muestra solo `api`.
- [x] La fila de la migración nueva conserva posición, hash e instante tras reiniciar y tras recrear `api`.
- [x] `status` con un `Bearer` inventado da 401 en la Pi, y una sesión normal entra y lee.
- [x] La carpeta del secreto de Kira y `DOMUS_KIRA_KEY` ya no están, borradas después de las tres comprobaciones anteriores.
- [ ] La copia de la primera noche sale bien.
- [x] `despliegue.md`, la guía, el README de arquitectura, el glosario y el plan describen lo que queda.

## Comments

- La Pi corre `main` en `da1913c` desde el 2026-11-15, desplegado con `docker compose up -d --build --remove-orphans`: salieron los contenedores de `assistant` y `voice-gateway`, y solo corre `api`, `healthy`.
- El primer arranque dijo `1 migrations applied`. La fila de `0017_damp_carlie_cooper`, en la posición 18 de `platform`, conservó hash y `applied_at` tras `docker compose restart api` y tras `docker compose up -d --force-recreate api`; `platform_keys`, `platform_mandates`, `context_only` y `window_closes_at` ya no están.
- `status` sin credencial respondió `{"json":{"service":"domus","protocol":1}}`, y con `Authorization: Bearer` inventado o con `domus-mandate`, `401`; `/health` siguió en `ok`, y sin sesión `log/read` dio `401` y `probe/listNotes`, `404`. Con una sesión de Paco (la contraseña la tecleó él), `sessions/list` y `log/read` dieron `200`, y con un `Bearer` añadido, `401`; la sesión se cerró después.
- Después se borraron `/home/fvena/.config/domus/kira-key` y `DOMUS_KIRA_KEY` del `.env` de la Pi; `docker compose config` siguió bien y `api`, `healthy`.
- La documentación queda al día en el commit «docs: close phase 1f on the Pi, waiting only for its first night's copy»: `despliegue.md`, la guía (`seguridad.md`, `permisos.md`, `programas.md`, `arquitectura.md`, `la-pi.md`, la portada y una frase de `acciones.md`, revisadas con `humanizer`), el README de arquitectura, el glosario y el plan, que da la 1f por hecha cuando salga bien la copia.
- Falta la copia de la primera noche, la del 2026-11-16 a las 05:00. Esta tarea sigue en `ready-for-agent` hasta comprobarla.

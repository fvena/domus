# 06. La Pi y el cierre

Status: ready-for-agent
Blocked by: 05

Spec: [`../spec.md`](../spec.md), secciones «La comprobación en la Pi» y «Reglas y documentación». ADR 0034.

## Qué construir

La 1f llega a la Pi, la Pi queda con solo `api`, y la documentación para personas cuenta lo que queda. La 1f se da por hecha cuando la copia de la primera noche sale bien.

- **En la Pi, en el Domus real, en este orden:** desplegar con `docker compose up -d --remove-orphans`; comprobar que solo corre `api`, la fila de la migración nueva, y que sigue igual tras reiniciar y tras recrear `api`; comprobar que `status` con un `Bearer` inventado da 401 y que una sesión normal entra y lee; borrar la carpeta del secreto de Kira y quitar `DOMUS_KIRA_KEY` de la configuración de la Pi; al día siguiente, comprobar la copia de esa noche. La persona solo teclea contraseñas.
- **Documentación:** `despliegue.md`, sin «Las llaves», sin las filas y los logs de los dos programas y sin la revocación de llaves al restaurar; la guía (`seguridad.md`, `permisos.md`, `programas.md`, `arquitectura.md`, `la-pi.md` y la portada), revisada con `humanizer`; el README de arquitectura, que deja de describir los programas y la llave como vigentes; el glosario, sin **Llave** ni **App conectada**, con **Agente conectado** sin definirse como app conectada, **Mandato** con el sentido del ADR 0032 y **Contexto verificado** sin «la conversación», que todavía lista; y el plan, con la 1f hecha.

## Criterios de aceptación

- [ ] `docker compose ps` en la Pi muestra solo `api`.
- [ ] La fila de la migración nueva conserva posición, hash e instante tras reiniciar y tras recrear `api`.
- [ ] `status` con un `Bearer` inventado da 401 en la Pi, y una sesión normal entra y lee.
- [ ] La carpeta del secreto de Kira y `DOMUS_KIRA_KEY` ya no están, borradas después de las tres comprobaciones anteriores.
- [ ] La copia de la primera noche sale bien.
- [ ] `despliegue.md`, la guía, el README de arquitectura, el glosario y el plan describen lo que queda.

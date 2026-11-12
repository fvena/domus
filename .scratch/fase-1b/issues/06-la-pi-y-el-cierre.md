# 06. La Pi y el cierre de la 1b

Status: ready-for-agent
Blocked by: 05

Spec: [`../spec.md`](../spec.md), secciones «Puerta, `apps/api` y la Pi», «Decisiones de prueba» (pruebas de `tooling`) y «Notas». Plan: criterio de «terminada» de la 1b.

## Qué construir

La 1b corre en la Pi con `platform/0001` aplicada y queda cerrada en los documentos.

- `real-modules.test.ts`: la composición completa sigue funcionando y la lista de migraciones aplicadas incluye `platform/0001`. No repite las pruebas del registro.
- `docs/despliegue.md`: la comprobación de la 1a se amplía para leer también la fila de `platform/0001` y para comprobar que `status` sigue siendo la única RPC.
- En la Pi, tras desplegar `main`: la fila de `platform/0001` conserva posición, hash e instante de aplicación después de `docker compose restart api` y de recrear `api` conservando el volumen.
- Cierre: el estado de la 1b en `docs/plan.md` y la revisión de `docs/guia/` según `docs/AGENTS.md` (la 1b no cambia nada que vea la familia; como mucho, una mención en la parte de arquitectura), revisada con la skill `humanizer`.

## Aceptación

- [ ] `real-modules.test.ts` comprueba `platform/0001`.
- [ ] `docs/despliegue.md` describe la comprobación ampliada.
- [ ] En la Pi, la comprobación da la misma fila de `platform/0001` antes y después de reiniciar y de recrear `api`, y `status` es la única RPC. Esta parte la hace una persona con acceso a la Pi.
- [ ] `docs/plan.md` marca la 1b como hecha, con su fecha, y `docs/guia/` está al día.
- [ ] Pasan `pnpm format:check`, `pnpm lint`, `pnpm type-check`, `pnpm test` y `pnpm build`.

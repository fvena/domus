# 11. La Pi y el cierre de la 1c

Status: ready-for-agent
Blocked by: 01, 02, 03, 04, 05, 06, 07, 08, 09, 10

Spec: [`../spec.md`](../spec.md), sección «Documentos y la Pi». ADR 0023.

## Qué construir

La 1c publicada en la Pi y cerrada en los documentos:

- **`docs/despliegue.md`** explica cómo crear las dos cuentas con `pnpm accounts` dentro del contenedor `api` y cómo comprobar la 1c en la Pi:
    - una sesión entra;
    - una operación permitida de la plataforma funciona;
    - una denegada falla;
    - tras `restart` y tras recrear `api`, la sesión sigue y la revocada no;
    - las filas de `platform/0000` y `0001` conservan posición, hash e instante, y desde `platform/0002` las migraciones se aplican sobre la base existente.
- **`docs/plan.md`** marca la 1c como hecha, con la fecha.
- **`docs/guia/`** recoge lo construido, según `docs/AGENTS.md`, revisado con la skill `humanizer`.
- **Arquitectura, glosario y ADR 0023**: se corrigen solo si la implementación los contradijo.

## Aceptación

- [ ] La comprobación de `despliegue.md` pasa en la Pi con `main`.
- [ ] El plan, la guía y, si hace falta, la arquitectura y el glosario están al día.
- [ ] Pasan `pnpm format:check`, `pnpm lint`, `pnpm type-check`, `pnpm test` y `pnpm build`, y `pnpm db:generate && pnpm modules:generate` dejan `git status --porcelain` vacío.

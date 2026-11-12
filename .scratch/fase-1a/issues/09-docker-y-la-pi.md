# 09. El binario nativo en Docker y la comprobación en la Pi

Status: resolved
Blocked by: 08

Spec: [`../spec.md`](../spec.md), sección «Docker y la Pi».

La imagen `api` lleva `better-sqlite3` para su arquitectura, y la Pi demuestra que los datos persisten en el volumen.

## Qué hacer

- `better-sqlite3` fuera del bundle (`--external:better-sqlite3` en el `build` de `apps/api`).
- `docker/Dockerfile`: la etapa `build` corre en la arquitectura de quien construye y solo copia los `dist/`. La imagen `api` necesita además `better-sqlite3` instalado para la arquitectura de destino (amd64 y arm64), sin llevar pnpm ni el resto de dependencias. La etapa concreta se elige al implementar; las otras dos imágenes no cambian.
- `docs/despliegue.md`:
    - dónde vive el fichero (`/data/domus.db` en el volumen `domus_domus-data`) y que las copias de seguridad llegan en la 1d;
    - la comprobación de persistencia: leer la fila de `platform/0000` con `docker compose exec api node -e "…"`, abriendo el fichero en solo lectura y con `fileMustExist`; `docker compose restart api` y volver a leer; `docker compose up -d --force-recreate api` y volver a leer. La fila completa, `applied_at` incluido, es la misma en las tres lecturas, y no hay filas nuevas.

## Aceptación

- `docker compose up -d --build` en local arranca los tres contenedores `healthy`, y el log de `api` dice `database at /data/domus.db: 1 migrations applied` en el primer arranque y `0` en los siguientes.
- En la Pi (`ssh kira`), tras actualizar como dice `docs/despliegue.md`, la comprobación de persistencia da la misma fila en las tres lecturas. Esta parte la ejecuta o la confirma Paco.
- Pasan `pnpm format:check`, `pnpm lint`, `pnpm type-check`, `pnpm test` y `pnpm build`.

## Comments

- Hecha en `b1ca928`: `better-sqlite3` fuera del bundle y en la imagen `api`, comprobado en local con arm64 y amd64. Falta la comprobación de persistencia en la Pi, que hace Paco con los pasos de `docs/despliegue.md`, sección «La base de datos», cuando la fase 1a esté en `main`.
- 2026-11-12: Paco actualizó la Pi a `main` (`40b9ee2`) e hizo la comprobación de persistencia: la fila de `platform/0000` es la misma en las tres lecturas, antes y después de `restart` y de `--force-recreate`.

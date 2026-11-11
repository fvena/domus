# 05. `pnpm db:generate` y `migrations.ts`

Status: ready-for-agent
Blocked by: 03

Spec: [`../spec.md`](../spec.md), sección «Migraciones», apartados «Generación» y «CI».

Convierte las migraciones de `drizzle-kit` en datos que viajan con la definición del módulo.

## Qué hacer

- `drizzle-kit` como dependencia de desarrollo de la raíz (o de `tooling`), y el script raíz `pnpm db:generate`, que para cada carpeta de `modules/` con `server/schema.ts`:
    1. ejecuta `drizzle-kit generate` con el esquema del módulo y salida en `modules/<id>/server/migrations/`;
    2. escribe `modules/<id>/server/migrations.ts` con un `export const migrations: ModuleMigration[]`.
- `migrations.ts` sale de `readMigrationFiles` de `drizzle-orm/migrator` (sentencias y hash), más el `tag` y la posición del `_journal.json`. El generador comprueba que las dos fuentes se corresponden: mismo número de entradas, en el mismo orden. Si cambian en otra versión de Drizzle, falla con un mensaje claro.
- Determinista: sin la hora de la generación, en el orden del journal y formateado con Oxfmt. Ejecutarlo dos veces seguidas no cambia nada.
- Rechaza una migración con sentencias de control de transacción (`BEGIN`, `COMMIT`, `END`, `ROLLBACK`, `SAVEPOINT`, `RELEASE`). Detecta sentencias, no palabras: ignora comentarios y cadenas, y acepta el `BEGIN…END` de un `CREATE TRIGGER`.
- El código del generador vive en `tooling/scripts` y lo cubren sus pruebas.
- En la CI (`.github/workflows`): ejecutar `pnpm db:generate` sin terminal interactiva (stdin cerrado, con tiempo límite) y exigir `git status --porcelain` vacío. La tarea 07 añade `pnpm modules:generate` al mismo paso.

## Aceptación

Pruebas en `tooling/scripts`, sobre migraciones de fixture:

- `migrations.ts` es el esperado y no cambia al generar dos veces;
- una discrepancia entre `readMigrationFiles` y el journal falla;
- se rechaza `BEGIN;`, `COMMIT;`, `ROLLBACK;` y `SAVEPOINT x;`; se aceptan un comentario con «begin», una cadena con «COMMIT» y un trigger `BEGIN … END;`.

Además, pasan `pnpm format:check`, `pnpm lint`, `pnpm type-check` y `pnpm test`.

# Fase 1a: base de datos y módulos

Status: ready-for-agent

Resultado del grilling de la fase 1a ([`docs/plan.md`](../../docs/plan.md)), del 2026-11-12, preguntas Q1–Q24. Fija cómo guarda Domus sus datos, cómo se registran los módulos y cómo los recibe la puerta. Las decisiones van al [ADR 0021](../../docs/architecture/adr/0021-datos-de-los-modulos-y-migraciones.md), que escribe la tarea 01; si esta spec y el ADR no coinciden, manda el ADR.

## Alcance

Entra:

- SQLite con `better-sqlite3` en `platform`, un solo fichero, y la `platform` en memoria de `test-utils`.
- La forma mínima de `module-sdk`: `defineModule` y las tablas con prefijo, sobre Drizzle.
- Las migraciones: generadas con `drizzle-kit`, transportadas como datos y aplicadas por un ejecutor propio.
- El módulo de prueba `probe`.
- La lista de módulos de `api`, generada, guardada en git y comprobada.
- La puerta recibe `platform` y la lista; `apps/api` las compone.
- El binario nativo en la imagen arm64 y la comprobación en la Pi.

No entra:

- Ninguna ruta HTTP nueva (Q1). Las acciones son de la 1b y la autorización de la 1c. `status` sigue siendo la única RPC.
- Contexto ni cliente de base de datos para el código de producción de un módulo: llega con las acciones (1b). En la 1a solo las pruebas tocan las tablas de un módulo.
- Copias de seguridad: van a la 1d (Q6).
- La lista de módulos de la web: llega con la primera pantalla de un módulo (Q13).
- Los helpers `instant()` y `localDate()`: la convención queda escrita y cada uno entra con su primer uso (Q21).

## Decisiones

### Base de datos (Q3, Q5, Q8, Q14)

- `better-sqlite3`, en modo WAL y con `foreign_keys=ON` tras inicializar. `node:sqlite` se descarta porque en Node 22 es experimental.
- Un solo fichero, `domus.db`, dentro de `DOMUS_DATA_DIR`. Las tablas de cada módulo llevan su id como prefijo (`probe_notes`) y las de la plataforma, `platform_`. El prefijo evita choques de nombre; no da acceso a las tablas de otro.
- `DOMUS_DATA_DIR` es `/data` en Docker (ya lo pone `docker/Dockerfile`). En desarrollo, el script `dev` de `apps/api` la fija en `<repo>/data` si no está definida, calculada desde su propia carpeta; `.gitignore` ya ignora `/data`. `readConfig` rechaza una ruta relativa o ausente con un mensaje claro. `.env.local.example` la documenta comentada.
- Las pruebas usan `:memory:` por defecto, y un fichero en un directorio temporal para persistencia, WAL y migraciones sobre datos existentes.

### Forma del módulo (Q2, Q9, Q10, Q20, Q21)

```ts
// modules/probe/server/schema.ts
import { id, moduleTables, text } from "@domus/module-sdk/db";

const { table } = moduleTables("probe");

export const notes = table("notes", { id: id(), body: text().notNull() }); // probe_notes
```

```ts
// modules/probe/server/index.ts
import { defineModule } from "@domus/module-sdk";

import { migrations } from "./migrations"; // generado por pnpm db:generate
import * as schema from "./schema";

export default defineModule({ id: "probe", testOnly: true, schema, migrations });
```

- `defineModule` lleva en la 1a solo `id`, `testOnly`, `schema` y `migrations`. Cada subfase añade su pieza cuando llega, sin campos reservados.
- El id es `[a-z][a-z0-9]*` (sin guiones bajos, para que un prefijo nunca choque con otro), igual al nombre de la carpeta. `platform` está reservado. No se admiten ids repetidos.
- `moduleTables(id)` pone el prefijo al crear la tabla. Al registrar, cada tabla del esquema tiene que llevar el prefijo de su propio módulo.
- `id()` es el valor por defecto para la clave: `INTEGER PRIMARY KEY AUTOINCREMENT`, que no reutiliza ids confirmados de una misma tabla. No es obligatorio: valen claves compuestas o ids que imponga una integración. La auditoría (1c) identificará un registro por módulo, tipo e id.
- Convención escrita, sin helper todavía: los instantes en milisegundos desde el epoch Unix, en un entero; las fechas civiles en texto `YYYY-MM-DD`, sin zona. Una fecha sola no es un instante: convertirla exige elegir hora y zona (`@domus/utils/date-time`, con su primer uso).
- `drizzle-orm` entra en `DATA_AND_AI_LIBS` de `.dependency-cruiser.cjs`. Solo lo importan `platform` y `module-sdk`; los módulos usan lo que reexporta `@domus/module-sdk/db`.
- Separación entre módulos: disciplina comprobada (tipos, reglas de importación, prefijo comprobado al registrar y revisión), no una barrera de seguridad, porque los módulos son código propio. El SQL escrito a mano con `sql` se vigila en la revisión (`CODING_STANDARDS.md`).
- Claves ajenas solo hacia tablas del propio módulo (Q18). Entre módulos, las referencias son ids que se resuelven por `contracts`, sin integridad referencial: cuando llegue un caso real, sus acciones deciden qué hacer con una referencia que ya no existe. Las claves hacia tablas `platform_` se deciden en la 1c.

### Módulo de prueba (Q2)

- `modules/probe/`, con todas las reglas de un módulo. Sirve a toda la fase 1: al final cubrirá permiso, confirmación y visibilidad.
- `testOnly: true`: el generador de la lista lo deja fuera antes de escribir las importaciones de producción, y una prueba lo comprueba.
- Las pruebas lo importan y lo inyectan en `test-utils`; `test-utils` nunca importa un módulo (`packages-never-import-modules`).

### Migraciones (Q11, Q15–Q17, Q19)

**Generación.** `pnpm db:generate` ejecuta `drizzle-kit generate` para cada módulo (salida en `modules/<id>/server/migrations/`, en git) y después escribe `modules/<id>/server/migrations.ts`:

- Con lo que devuelve el `readMigrationFiles` público de `drizzle-orm/migrator` (sentencias, hash), más el `tag` y la posición sacados del `_journal.json`, comprobando que se corresponden en la versión instalada.
- Determinista: sin la hora de la generación, en el orden del journal y formateado con Oxfmt. Fuera de cualquier carpeta `generated/`.
- Rechaza una migración que contenga sentencias de control de transacción (`BEGIN`, `COMMIT`, `ROLLBACK`, `SAVEPOINT`, `RELEASE`, `END` como sentencia). Detecta sentencias, no palabras: comentarios, cadenas y el `BEGIN…END` de un trigger son legítimos.

Las migraciones de la plataforma siguen la misma forma, en `packages/platform`. La primera, `platform/0000`, crea `platform_migrations` y se anota a sí misma (Q24).

**Historial.** `platform_migrations (module, position, tag, hash, applied_at)`, con `(module, position)` y `(module, tag)` únicos. `applied_at` es solo información; el orden lo da `position`. Si la tabla no existe, el historial está vacío.

**Ejecutor.** Propio, en `platform`, sobre la conexión de `better-sqlite3`, sin nada interno de Drizzle (el migrador de Drizzle confirma dentro de `dialect.migrate`, no comprueba hashes ni trata las claves ajenas). Al arrancar, en este orden:

1. Valida el historial antes de cambiar nada. Para cada módulo, lo aplicado tiene que ser un prefijo exacto de lo que trae el código: mismos `tag`, misma posición y mismo hash. Rechaza el arranque, con un mensaje que nombra módulo y migración, si una aplicada cambió de hash, si falta en el código o el orden no coincide, o si hay filas de un módulo que ya no está en la lista. Quitar un módulo con sus datos se decide con P49.
2. `PRAGMA foreign_keys=OFF`, fuera de la transacción, siempre.
3. `BEGIN`. Aplica las pendientes de `platform` y de todos los módulos, en el orden de la lista, y anota cada una en el historial dentro de la misma transacción. Los `PRAGMA foreign_keys` que escribe `drizzle-kit` dentro de una migración no hacen nada dentro de la transacción y se dejan.
4. `PRAGMA foreign_key_check`. Cualquier error, del SQL o de esta comprobación, hace `ROLLBACK`; si no, `COMMIT`.
5. En `finally`, `foreign_keys=ON`. Si algo falló, `createPlatform` cierra la conexión y lanza el error, y `api` no arranca.

Garantía (Q16): todo el arranque es una sola transacción; si la migración falla, se conservan el esquema, los datos y el historial anteriores. No promete volver a la imagen anterior tras una migración que funcionó: esa imagen rechazará el historial más nuevo.

**CI.** Ejecuta `pnpm db:generate` y `pnpm modules:generate` sin terminal interactiva (stdin cerrado, con tiempo límite) y exige `git status --porcelain` vacío, ficheros nuevos sin seguimiento incluidos. Si `drizzle-kit` pregunta algo, la CI falla: se genera en local y se revisa el resultado.

### Lista de módulos (Q7, Q13)

- `pnpm modules:generate` escribe la lista de `api`: importa el `server/index.ts` de cada módulo de `modules/` que no es `testOnly`. Comprueba que el id coincide con la carpeta.
- Guardada en git, fuera de cualquier carpeta `generated/` para que dependency-cruiser la revise (`api-reaches-modules-through-server-entry`).
- Una prueba de `tooling/scripts` la regenera en memoria y la compara sin escribir.
- Solo la lista de `api`; el generador queda sencillo de ampliar cuando llegue la web.

### Composición (Q1, Q12)

- `createPlatform({ databaseFile, modules })` abre SQLite, aplica las migraciones y devuelve la `platform`. `platform.close()` cierra SQLite y se puede llamar varias veces.
- `createHttpHandler({ platform, modules })` los recibe y no publica nada nuevo.
- `apps/api` lee `DOMUS_DATA_DIR`, importa la lista generada, compone las dos piezas, escribe en el log `database at <ruta>: <N> migrations applied` y cierra la `platform` desde el `onShutdown` existente.
- `createTestPlatform({ modules, file? })` usa `:memory:` por defecto, o un fichero. Devuelve la `platform`, la puerta y `dbFor(module)`. Se puede usar con `await using` y tiene `close()`, los dos idempotentes. Borra solo el directorio temporal que creó; una ruta que le pasa quien llama se conserva.
- `dbFor` solo existe en `test-utils`. Toda acción se ejecutará con autorización; las pruebas de almacenamiento pueden preparar y consultar datos directamente.

### Hueco hasta la autorización (Q1)

Hasta la 1c, las acciones de los módulos no se montan en el router HTTP. La llamada desde la web con `clientFor` de la 1b queda aplazada hasta que haya autorización. Cómo se cubre el hueco lo decide el grilling de la 1b, con una condición: ninguna acción se ejecuta sin pasar por la autorización.

### Docker y la Pi (Q3, Q24)

- `better-sqlite3` queda fuera del bundle de esbuild (`--external`), y la imagen `api` lleva su binario para la arquitectura de destino. pnpm permite su build. La etapa concreta se elige al implementar; el requisito es que el binario correcto llegue a la imagen y funcione en la Pi.
- Comprobación en la Pi, escrita en `docs/despliegue.md`:
    1. Leer la fila de `platform/0000` con `docker compose exec api node -e "…"`, abriendo `/data/domus.db` en solo lectura y con `fileMustExist`.
    2. `docker compose restart api` y volver a leer: la fila completa, `applied_at` incluido, es la misma, y no hay filas nuevas.
    3. `docker compose up -d --force-recreate api`, conservando el volumen, y volver a leer con el mismo resultado.

## Terminada cuando (Q22)

- `modules/probe` existe, con su tabla y sus migraciones, inyectado en las pruebas y fuera de la lista de producción.
- Pruebas de `platform`, con definiciones escritas dentro de la propia prueba:
    - WAL activo sobre fichero y `foreign_keys=ON` tras inicializar;
    - aplicar todo desde cero;
    - actualizar con datos existentes, incluida la reconstrucción de una tabla a la que apunta una clave ajena;
    - crear y borrar el id más alto, migrar con reconstrucción y comprobar que la siguiente inserción no lo reutiliza;
    - un fallo de SQL y, por separado, una violación que detecta `foreign_key_check`: en los dos se conservan datos, esquema e historial, sin filas nuevas;
    - los cuatro casos de historial rechazado (hash cambiado, migración que falta, orden distinto, módulo que ya no está);
    - id inválido, `platform` reservado, id repetido y tabla sin el prefijo de su módulo;
    - persistencia al cerrar y reabrir, recursos liberados si la inicialización falla, y `close()` idempotente.
- Pruebas de `test-utils`: en memoria y sobre fichero; borra solo lo que creó; `close()` y `await using` idempotentes.
- Pruebas de `tooling`: la lista está al día y no incluye `probe`; todas las migraciones reales se aplican sobre un fichero temporal; ninguna clave ajena sale de su módulo; cada tabla de `sqlite_master` (salvo `sqlite_*`) empieza por `platform_` o por el prefijo de un módulo registrado; el generador de migraciones rechaza las sentencias de control de transacción y acepta un trigger.
- La CI deja `git status --porcelain` vacío tras `pnpm db:generate` y `pnpm modules:generate`.
- La puerta recibe `platform` y la lista, y `status` sigue siendo la única RPC.
- Pasan `pnpm format:check`, `pnpm lint`, `pnpm type-check`, `pnpm test` y `pnpm build`.
- En la Pi, la comprobación de `docs/despliegue.md` da la misma fila de `platform/0000` antes y después de reiniciar y de recrear `api`.
- Los documentos de la tarea 01 están al día.

## Tareas

| Tarea                                        | Qué                                                          | Bloqueada por |
| -------------------------------------------- | ------------------------------------------------------------ | ------------- |
| [01](issues/01-adr-y-documentos.md)          | ADR 0021 y documentos                                        | —             |
| [02](issues/02-sqlite-en-platform.md)        | SQLite en `platform` y `test-utils`                          | 01            |
| [03](issues/03-module-sdk.md)                | `defineModule` y tablas con prefijo en `module-sdk`          | 01            |
| [04](issues/04-ejecutor-de-migraciones.md)   | Ejecutor de migraciones y `platform/0000`                    | 02, 03        |
| [05](issues/05-generacion-de-migraciones.md) | `pnpm db:generate` y `migrations.ts`                         | 03            |
| [06](issues/06-modulo-probe.md)              | El módulo `probe`                                            | 04, 05        |
| [07](issues/07-lista-de-modulos.md)          | `pnpm modules:generate`, la lista y las pruebas de `tooling` | 05, 06        |
| [08](issues/08-puerta-y-apps-api.md)         | La puerta y `apps/api` componen `platform`                   | 04, 07        |
| [09](issues/09-docker-y-la-pi.md)            | El binario nativo en Docker y la comprobación en la Pi       | 08            |

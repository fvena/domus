# 01. ADR 0021 y documentos

Status: resolved
Blocked by: —

Spec: [`../spec.md`](../spec.md).

Deja escritas las decisiones de la 1a antes del código, para que las tareas siguientes las sigan.

## Qué hacer

- **ADR 0021, «Datos de los módulos y migraciones»** (`docs/architecture/adr/0021-datos-de-los-modulos-y-migraciones.md`), en el estilo de los anteriores: un párrafo por decisión, fecha y preguntas (Q1–Q24 del grilling de la fase 1a). Precisa los ADR 0017 y 0020 sin sustituirlos. Recoge:
    - un solo fichero SQLite con `better-sqlite3`, WAL y claves ajenas;
    - Drizzle solo a través de `module-sdk`; `drizzle-orm` entre las librerías de datos;
    - prefijos por módulo, id `[a-z][a-z0-9]*`, `platform` reservado, claves ajenas solo dentro del módulo;
    - `id()` como clave por defecto; la convención de instantes y fechas civiles, sin helper hasta su primer uso;
    - la separación como disciplina comprobada, no barrera de seguridad;
    - migraciones como datos, ejecutor propio, una sola transacción en el arranque, y las reglas del historial;
    - la lista de módulos generada, guardada en git y comprobada (ya no «generada en el build»);
    - `testOnly` y el módulo de prueba;
    - el hueco hasta la autorización.
- **ADR 0017 y 0020:** una línea al final, «Precisado por el ADR 0021: …», como la que ya tiene el 0017.
- **`docs/architecture/README.md`:** el §5 (registro de módulos) y la fila del índice.
- **`docs/plan.md`:**
    - 1a: su alcance y cuándo termina, con enlace a esta spec;
    - 1b: hasta la 1c las acciones no se montan en HTTP, la llamada desde la web con `clientFor` queda aplazada, y ninguna acción se ejecuta sin autorización;
    - 1d: las copias de seguridad, fuera de la Pi, con retención y restauración probada;
    - fase 3: las copias y una restauración probada, listas antes del uso real.
- **`GLOSSARY.md`:** «Migración» y «Módulo de prueba».
- **`modules/AGENTS.md`:** `testOnly`, `pnpm db:generate`, `pnpm modules:generate` y la lista guardada en git. Respetar el tope de 40 líneas.
- **`CODING_STANDARDS.md`:** el SQL escrito a mano con `sql` se revisa, porque no lo cubren los tipos del módulo.
- **Frases antiguas:** buscar «generated at build time», «generada en el build» y parecidas en todo el repositorio, incluidos los comentarios de `.dependency-cruiser.cjs`, `modules/AGENTS.md` y `packages/module-sdk/index.ts`, y corregirlas.

`.env.local.example` y `docs/despliegue.md` cambian en las tareas 08 y 09, con el código.

## Aceptación

- Pasa la comprobación del índice y los enlaces de los ADR y la del tamaño de los `AGENTS.md` (`pnpm test` en `tooling`).
- No queda ninguna frase que diga que la lista se genera en el build.
- `pnpm format:check` y `pnpm lint` pasan.

## Comments

- Hecha en `4c96238` (ADR 0021 y documentos). En la revisión (`d3e35fa`) el ADR 0021 pasó a decir qué decisión de los ADR 0017 y 0020 sustituye, la regla de `@domus/platform/testing` y que las migraciones de la plataforma se escriben a mano.

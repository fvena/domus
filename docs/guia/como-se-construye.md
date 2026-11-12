# Cómo se construye y se comprueba

## Qué es

Cómo trabajamos en Domus: cómo decidimos qué construir, quién lo construye y qué se revisa antes de aceptar un cambio.

## Cómo funciona

Domus se construye por fases, y cada fase se parte en piezas pequeñas. Solo se construye lo que pide la fase en la que estamos.

Antes de escribir código, cada pieza pasa por un grilling: una ronda de preguntas, una a una, hasta que no queda nada sin decidir. De ahí salen una especificación y una lista de tareas. Las decisiones que van a importar a largo plazo se escriben aparte, en un ADR, que es un documento corto con la decisión y su motivo.

Buena parte del código la escriben agentes de IA, a partir de la especificación y de unas instrucciones que hay en cada carpeta grande. Ningún cambio entra en la rama principal sin que una persona lo revise y lo apruebe.

Cada cambio pasa por dos filtros automáticos. El primero, en el propio ordenador, antes de guardarlo: busca secretos, revisa el estilo y el formato y comprueba que no haya errores de tipos. El segundo, en GitHub, repite todo eso y añade las pruebas, la construcción de los programas y sus contenedores, y una revisión de que los ficheros que se generan solos estén al día. Si algo falla, el cambio no entra.

Las reglas sobre qué parte puede usar a cuál también se comprueban en cada cambio, y cada regla tiene su propia prueba que demuestra que salta cuando toca.

Para las pruebas usamos una plataforma de verdad, con su base de datos en memoria, en lugar de imitaciones.

## Por qué es así

Decidir antes de construir sale más barato que rehacer después.

Las comprobaciones automáticas no dependen de que alguien se fije. Un secreto o una capa mal usada se paran igual un lunes por la mañana que un domingo a medianoche.

Y como gran parte del código lo escriben agentes, lo que mantiene el proyecto coherente son las instrucciones escritas y las comprobaciones, más que la memoria de nadie.

## En el código

- Plan y decisiones: el plan está en [`docs/plan.md`](../plan.md); las especificaciones y tareas de cada fase, en `.scratch/<fase>/`; los ADR, en [`docs/architecture/adr/`](../architecture/adr/); las normas que piden criterio, en [`CODING_STANDARDS.md`](../../CODING_STANDARDS.md); las instrucciones para agentes, en los `AGENTS.md`.
- Herramientas: Node 22, pnpm, Turborepo, TypeScript sobre tsgo, Vitest, Oxlint, Oxfmt y dependency-cruiser.
- Comandos: `pnpm install`, `pnpm dev`, `pnpm build`, `pnpm lint`, `pnpm format`, `pnpm type-check`, `pnpm test`, `pnpm db:generate` y `pnpm modules:generate`. La tabla completa está en [`AGENTS.md`](../../AGENTS.md).
- Antes de cada commit: `.githooks/pre-commit` (gitleaks, lint, formato y tipos).
- En cada PR: `.github/workflows/validate-prs.yml`, con secretos, lint y formato, ficheros generados, tipos, build, pruebas e imágenes.
- Comprobaciones del repositorio: `tooling/scripts`, con las reglas de capas (`architecture.test.ts`), los ADR (`adr.test.ts`) y el tamaño de los `AGENTS.md` (`agents-md.test.ts`).
- Decisiones: [ADR 0017](../architecture/adr/0017-estructura-del-repositorio.md), [ADR 0018](../architecture/adr/0018-patrones-de-openclaw-y-hermes.md) y [ADR 0019](../architecture/adr/0019-oxlint-y-oxfmt.md).

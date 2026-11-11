# Patrones de OpenClaw y Hermes

De OpenClaw y Hermes se adoptan: skills como carpetas; cada canal declara su formato; pruebas de escenario con un canal falso y un modelo falso; una prueba de que el prompt y las tools no cambian entre turnos; un `AGENTS.md` por carpeta grande con tamaño máximo (comprobado por `tooling/scripts/agents-md.test.ts`); y la «escalera» de dónde va una funcionalidad nueva, que está en el `AGENTS.md` raíz. No se adoptan tiendas de plugins, proveedores de sobra, «un agent por persona» ni manifiestos enormes.

Fecha: 2026-11-11. Preguntas del grilling: P40.

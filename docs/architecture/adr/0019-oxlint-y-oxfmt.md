# Oxlint y Oxfmt para lint y formato

Oxlint hace el lint con información de tipos (`typeAware` y `typeCheck`, a través de `oxlint-tsgolint`) y Oxfmt da formato a TypeScript, Vue, JSON y Markdown: tabuladores, comillas dobles, 100 columnas, comas finales, imports ordenados por grupos y `package.json` ordenados. Las dos herramientas son rápidas, se configuran en `.oxlintrc.json` y `.oxfmtrc.json`, y el editor usa la extensión de Oxc para formatear al guardar. Oxlint todavía no revisa las plantillas de Vue; los tipos de las plantillas los comprueba `vue-tsc` en `type-check`. TypeScript corre sobre tsgo (TypeScript 6 con el compilador nativo), que acelera `type-check` y el lint con tipos.

Fecha: 2026-11-11. Origen: fase 0.

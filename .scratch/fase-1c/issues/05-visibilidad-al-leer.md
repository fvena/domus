# 05. Visibilidad al leer

Status: ready-for-agent
Blocked by: 03

Spec: [`../spec.md`](../spec.md), secciones «Áreas, permisos y perfiles» (lo que declara cada área), «Visibilidad en las lecturas» y «`probe`». ADR 0023, ADR 0009.

## Qué construir

Las tablas con dueño y el filtro de visibilidad en las lecturas:

- **`module-sdk/db`** declara una tabla con dueño: columnas de dueño y visibilidad, tipo de registro y área. La clave es la columna `id` entera, y la plataforma rechaza al arrancar una tabla con dueño con clave compuesta.
- **Cada área declara** su visibilidad por defecto, si lo público lo edita quien tenga `write`, `alwaysPrivate` y `confirmOnSharedDevice`. Un área `alwaysPrivate` pone un `CHECK` en sus tablas que rechaza lo público.
- **El contexto del manejador** da el predicado de visibilidad por tabla con dueño. Un registro que el predicado oculta responde «no encontrado».
- **`probe`:**
    - notas y comentarios con dueño;
    - las áreas `probe.board`, `probe.health` y `probe.secret`, con sus tablas;
    - un conteo, una búsqueda y un join de notas con comentarios, con un predicado por tabla.
- **Las formas de consulta admitidas** quedan escritas en el `AGENTS.md` de `modules/`.

Hasta que la 06 añada la captura de escrituras, `createPlatform` rechaza un módulo con tablas con dueño. Así producción no puede escribir en ellas sin protección, y las pruebas siguen funcionando con `createTestPlatform`.

## Aceptación

- [ ] Lo privado ajeno da «no encontrado» en la lectura, el conteo, la búsqueda y el join, y lo público se ve.
- [ ] Crear deja como dueño a la cuenta representada, con la visibilidad por defecto del área.
- [ ] `probe.health` y `probe.secret` no admiten un registro público, por el `CHECK`.
- [ ] Al arrancar se rechaza una tabla con dueño con clave compuesta, y `createPlatform` rechaza un módulo con tablas con dueño.
- [ ] Las pruebas de la 1b sobre notas y comentarios siguen pasando, con dueño.
- [ ] Pasan todas las comprobaciones, y la generación no deja cambios.

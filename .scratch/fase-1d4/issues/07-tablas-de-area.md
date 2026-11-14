# 07. Tablas de área

Status: ready-for-agent
Blocked by: 02, 05

Spec: [`../spec.md`](../spec.md), secciones «Tabla de área», «Lo que la escritura recuerda» (los registros declarados de una tabla de área), «El reparto de invalidaciones» y «`probe`» (`labels`). ADR 0029; «Tabla de área» en el glosario.

## Qué construir

Una lista común de la casa, sin dueño por registro, que ve quien tiene permiso en su área. Sus cambios se invalidan y sus registros pueden tener avisos, como los de una tabla con dueño. Una tabla sin dueño que no se declara así no avisa a nadie.

- **`areaTable(name, { type, area }, columns)`** en `moduleTables`, con `id` entero como única clave. `start` rechaza un tipo repetido entre las tablas con dueño y de área de un módulo.
- **Las invalidaciones**: los registros tocados que declara el manejador en una tabla de área llegan a toda sesión con `read` en su área.
- **Los avisos**: `ctx.notify` admite un `about` de una tabla de área. Al repartir y al entregar basta con que el registro exista y con el `read` del área.
- **`probe`**: la tabla de área `labels`, en el área `probe`, con `listLabels`, `addLabel({ name, notify? })` (deshacible, con inversa `deleteLabel`) y `deleteLabel({ id })` (irreversible), y su migración.

## Criterios de aceptación

- [ ] `addLabel` llega como invalidación a las dos personas con `read` en `probe` y a ninguna sesión sin él.
- [ ] Deshacer `addLabel` invalida la etiqueta borrada, y `deleteLabel` la que borra.
- [ ] Un cambio en una `table` sin declarar no invalida nada, y un `about` de ella revierte la escritura.
- [ ] `addLabel` con `notify` entrega el aviso a la otra persona hasta el servicio falso. Si la etiqueta se borra antes de repartir, el aviso queda `record-gone`; si el destinatario pierde `read` en el área, `not-visible`.
- [ ] Dos tablas de un módulo con el mismo tipo hacen fallar `start`.
- [ ] `pnpm check` pasa.

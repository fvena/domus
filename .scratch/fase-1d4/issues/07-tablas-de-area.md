# 07. Tablas de área

Status: resolved
Blocked by: 02, 05

Spec: [`../spec.md`](../spec.md), secciones «Tabla de área», «Lo que la escritura recuerda» (los registros declarados de una tabla de área), «El reparto de invalidaciones» y «`probe`» (`labels`). ADR 0029; «Tabla de área» en el glosario.

## Qué construir

Una lista común de la casa, sin dueño por registro, que ve quien tiene permiso en su área. Sus cambios se invalidan y sus registros pueden tener avisos, como los de una tabla con dueño. Una tabla sin dueño que no se declara así no avisa a nadie.

- **`areaTable(name, { type, area }, columns)`** en `moduleTables`, con `id` entero como única clave. `start` rechaza un tipo repetido entre las tablas con dueño y de área de un módulo.
- **Las invalidaciones**: los registros tocados que declara el manejador en una tabla de área llegan a toda sesión con `read` en su área.
- **Los avisos**: `ctx.notify` admite un `about` de una tabla de área. Al repartir y al entregar basta con que el registro exista y con el `read` del área.
- **`probe`**: la tabla de área `labels`, en el área `probe`, con `listLabels`, `addLabel({ name, notify? })` (deshacible, con inversa `deleteLabel`) y `deleteLabel({ id })` (irreversible), y su migración.

## Criterios de aceptación

- [x] `addLabel` llega como invalidación a las dos personas con `read` en `probe` y a ninguna sesión sin él.
- [x] Deshacer `addLabel` invalida la etiqueta borrada, y `deleteLabel` la que borra.
- [x] Un cambio en una `table` sin declarar no invalida nada, y un `about` de ella revierte la escritura.
- [x] `addLabel` con `notify` entrega el aviso a la otra persona hasta el servicio falso. Si la etiqueta se borra antes de repartir, el aviso queda `record-gone`; si el destinatario pierde `read` en el área, `not-visible`.
- [x] Dos tablas de un módulo con el mismo tipo hacen fallar `start`.
- [x] `pnpm check` pasa.

## Comments

- Hecho en `5e56bb4`.
- `areaTable(name, { type, area }, columns, extraConfig?)` en `moduleTables`, y `areaTableOf` en `module-sdk` (como `ownedTableOf`). `checkModules` comprueba las tablas con dueño y las de área juntas en `checkTables`; el tipo repetido es `two tables have the record type "<tipo>"`.
- `RecordChange` es ahora la unión de `OwnedRecordChange` (con `before` y `after`) y `AreaRecordChange` (sin ellos); `invalidationReaches` distingue por `"before" in change`. `NoticeRecord` es la unión de `OwnedNoticeRecord` y `AreaNoticeRecord` (solo `area`), y `noticeDecision` distingue por `"owner" in record`. `recordFacts` lee también las tablas de área.
- En `perform`, `areaChangesOf(module, touched)` toma de los registros tocados los de tablas de área, una vez cada uno, y se recuerdan después de los de la captura. `parts.recordTypes` suma los tipos de las tablas de área.
- Decidido sin preguntar, y anotado en la spec: `start` rechaza una tabla de área en un área `alwaysPrivate`; un registro tocado de tabla de área con un `id` que no es un número entero (también `"1"`) es un fallo interno; `probe` gana `scraps`, una `table` sin acciones, para probar la tabla sin declarar; `deleteLabel` no pide confirmación.

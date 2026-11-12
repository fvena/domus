# 06. Comprobar las escrituras con triggers temporales

Status: resolved
Blocked by: 05

Spec: [`../spec.md`](../spec.md), sección «Comprobar las escrituras». ADR 0023.

## Qué construir

La captura de transiciones de fila y su comprobación antes de confirmar cada escritura:

- **Al abrir la conexión**, después de las migraciones y antes de aceptar acciones, la plataforma activa `recursive_triggers`, crea la tabla temporal de captura y los triggers temporales `AFTER INSERT`, `AFTER UPDATE` (con `OLD` y `NEW`) y `AFTER DELETE` en cada tabla con dueño.
- **La captura** se vacía al empezar y al terminar cada escritura, confirme o revierta.
- **Antes de confirmar**, cada transición se comprueba en orden:
    - el dueño al crear;
    - que el dueño no cambie;
    - que la clave no cambie;
    - editar y borrar solo el dueño, o en un registro público si el área lo permite y la cuenta tiene `write`;
    - que la visibilidad solo la cambie el dueño;
    - que los registros con dueño de la captura estén entre los tocados que declaró el manejador.
- **Un fallo** lo revierte todo, con su entrada. Editar lo público ajeno sin que el área lo permita sale como «no permitido». Una forma de escribir que la captura no cubra se rechaza.
- **`probe`** gana la acción que cambia la visibilidad de una nota y las acciones de `probe.board`.
- **`createPlatform`** deja de rechazar los módulos con tablas con dueño.

## Aceptación

- [x] **Pruebas de `platform`,** con módulos escritos en la prueba: insertar con otro dueño; cambiar el dueño y restaurarlo; cambiar la clave; crear y borrar en la misma operación; modificaciones múltiples; UPSERT; `REPLACE`; un registro cambiado sin declararlo. Todos revierten el cambio y la entrada.
- [x] La captura empieza vacía en cada escritura, también después de una revertida, y los triggers existen antes de la primera acción.
- [x] **`probe`:** lo público ajeno no se edita en `probe` y sí en `probe.board`; la visibilidad solo la cambia el dueño.
- [x] Pasan todas las comprobaciones y el build.

## Comments

- Hecho en `a5b7721`.
- Dónde está cada cosa: `platform/actions/capture.ts` (la tabla temporal `platform_capture`, los tres triggers temporales por tabla con dueño, `recursive_triggers` y `watch`, que vacía la captura, ejecuta el manejador y devuelve sus transiciones en orden) y `platform/authorization/writes.ts` (`checkTransition`, puro, con las reglas: `allow`, `forbidden` o `invalid`). `perform` en `platform/actions` comprueba cada transición y que esté en `touched` con el tipo de registro de su tabla y del mismo módulo, antes de anotar la entrada, y vacía la captura al terminar. `openPlatform` instala la captura después de las migraciones y de la cuenta de aparato; `createActions` recibe además `view` (la vista de acceso) y `capture`.
- Qué sale como «no permitido»: editar o borrar lo público ajeno donde el área no es `publicEditable` o la cuenta no tiene `write` en el área del registro (no la de la acción), y cambiar la visibilidad de lo ajeno. Todo lo demás (otro dueño al crear, cambiar dueño o clave, tocar lo privado ajeno, un registro sin declarar o de otro módulo) es error interno.
- Formas que la captura no cubre y se rechazan: un manejador que apaga `recursive_triggers` (se vuelve a encender siempre, porque no es transaccional), que cambia el esquema (`schema_version` de `main` o de `temp`: borrar un trigger o una tabla, `ALTER`…) o que borra filas de la captura (hueco en su `AUTOINCREMENT`). Escrituras por otra conexión (`pnpm accounts`, el shell de sqlite) no se capturan; hoy ninguna toca tablas con dueño.
- `createPlatform` ya no rechaza módulos con tablas con dueño; la prueba de `platform.test.ts` pasa a comprobar que una migración que quita y vuelve a poner `visibility` corre sobre un fichero existente (los triggers temporales lo impedirían si se crearan antes). `real-modules.test.ts` vuelve a `createPlatform`.
- `probe` gana `setNoteVisibility` (deshacible) y `listBoard`, `addBoardNote`, `editBoardNote` (deshacibles) y `deleteBoardNote` (no deshacible), todas de `probe.board` salvo la primera.
- Para la 08: una lectura confirmada sigue con `query_only`, que bloquea también la tabla temporal; la captura solo se vacía y se llena dentro de `perform`, nunca en lecturas. Para la 10: la inversa pasa por `perform`, así que ya pasa por la captura (un `restoreNote` crea con dueño la cuenta representada, que en la 10 será siempre la que escribió).

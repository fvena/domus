# 02. Escrituras con su registro

Status: ready-for-agent
Blocked by: 01

Spec: [`../spec.md`](../spec.md), secciones «El recorrido» (la parte de escritura), «Registro de acciones», «Valores persistidos» y «`probe`». ADR 0022.

## Qué construir

Una prueba de `probe` invoca sus escrituras con un actor sintético y una clave, y cada una ejecuta su manejador en una transacción junto con su entrada del registro de acciones: resultado validado, inversa validada y guardada, registros tocados anotados. Un fallo en cualquier punto no deja ni cambio ni entrada.

Piezas que llegan con esta tarea:

- El ayudante de escritura en la entrada de contratos, con el metadato «se puede deshacer». El tipo del manejador exige la inversa solo cuando la escritura es deshacible.
- La migración `platform/0001`, escrita a mano, sin tocar `0000`: entradas con número de secuencia, anotación (módulo y acción, cuenta, `via`, clave, huella, instante, `expiresAt`, «deshace a», «deshecha por») y contenido (entrada, resultado, inversa); registros tocados aparte, con su índice; restricción única por cuenta, `via` y clave, contando la ausencia de `via` como un valor propio. Las columnas de caducidad y de deshacer se crean aquí aunque su lógica llegue en la 04 y la 05.
- `platform/audit`, con sentencias preparadas de `better-sqlite3`, que escribe dentro de la transacción y nunca confirma.
- El recorrido de escritura en `platform/actions`: exige la clave (sin ella, entrada no válida), abre la transacción, autoriza, ejecuta, valida el resultado y la inversa, comprueba los valores JSON sin pérdida y registra. Devuelve el resultado y el número de la entrada; la inversa nunca sale. Repetir una clave todavía no tiene su semántica: eso es la 03.
- La inversa es válida solo si nombra una acción de escritura del mismo módulo y su entrada pasa ese contrato y es JSON sin pérdida.
- `log()` en `createTestPlatform`: instantánea de solo lectura del registro, por la entrada de pruebas de `platform`.
- `probe`: `addNote`, `editNote`, `deleteNote` (rechaza borrar una nota con comentarios con un error propio del contrato), `restoreNote` y `addComment`, deshacibles con las inversas de la spec, y `deleteComment`, irreversible. Tipos de registro `note` y `comment`.

## Aceptación

- [ ] Pruebas de `probe`: cada escritura cambia los datos, devuelve resultado y número de entrada, y deja en `log()` su entrada con actor, `via`, clave, registros tocados e inversa; ningún resultado lleva la inversa; una escritura sin clave se rechaza; borrar una nota con comentarios devuelve el error del contrato y no deja ni cambio ni entrada.
- [ ] Pruebas de `platform` con la construcción de pruebas: resultado no válido; resultado o inversa que no son JSON sin pérdida; entrada con `undefined` en una propiedad; inversa ausente cuando es obligatoria; inversa hacia una lectura, hacia una acción desconocida o de otro módulo; entrada de la inversa no válida; y un fallo al escribir el registro. En todos, ni cambio ni entrada.
- [ ] Prueba de `platform`: `0001` se aplica sobre una base que solo tiene `0000` y las consultas del registro funcionan sobre las tablas reales.
- [ ] Pasan `pnpm format:check`, `pnpm lint`, `pnpm type-check` y `pnpm test`, y `pnpm db:generate && pnpm modules:generate` dejan `git status --porcelain` vacío.

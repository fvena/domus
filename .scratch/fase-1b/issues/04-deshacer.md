# 04. Deshacer

Status: resolved
Blocked by: 03

Spec: [`../spec.md`](../spec.md), sección «Deshacer». ADR 0022.

## Qué construir

Un miembro, directamente o por Kira, deshace una escritura dando el número de su entrada y una clave propia: la plataforma recupera la inversa guardada, comprueba que nada posterior tocó lo mismo, la autoriza y la ejecuta dentro de la misma transacción, y deja una sola entrada nueva enlazada con la original.

- `undo` en `platform/actions`, ofrecido por `createTestPlatform`. Nunca acepta una inversa que traiga quien llama.
- Huella de `undo`: la operación más el número de la entrada. Los pasos, en una transacción y una sección síncrona: clave (como en la 03, con esa huella); `already-undone`; `irreversible`; `changed-since` (cualquier entrada posterior que tocó alguno de sus registros, aunque se deshiciera después); autorización de la inversa con el contexto de la entrada original; ejecución de la inversa por dentro, sin abrir otra operación idempotente ni otra transacción.
- Una sola entrada nueva: clave y huella de la petición `undo`, la acción inversa ejecutada con su entrada, resultado, registros tocados e inversa propia, y «deshace a» la original. La original queda con «deshecha por».
- Rehacer es deshacer la entrada del deshacer, posible solo si la inversa dejó otra.
- `expired` llega en la 05.

## Aceptación

- [x] Pruebas de `probe`: deshacer funciona para crear, editar y borrar una nota; un cambio posterior bloquea con `changed-since`, también si ese cambio se deshizo; deshacer `addNote` después de añadir un comentario lo rechaza la regla del módulo; deshacer `deleteComment` da `irreversible`; deshacer dos veces con la misma clave devuelve el resultado anterior y con otra da `already-undone`; invocar directamente la inversa con la clave de un `undo` da `key-reused`; rehacer `editNote` funciona y rehacer `addComment` no; una denegación del autorizador impide deshacer; la inversa no aparece en ningún resultado.
- [x] Prueba de `platform` con la construcción de pruebas: si algo falla al deshacer, se revierten juntos la inversa, su entrada y «deshecha por».
- [x] Pasan `pnpm format:check`, `pnpm lint`, `pnpm type-check` y `pnpm test`.

## Comments

- Hecha en `807d539`.
- «No se puede deshacer» sale como `ORPCError` `UNPROCESSABLE_CONTENT` con el motivo en `data.reason` (`{ reason: "irreversible" }`), igual que un conflicto lleva el suyo; la spec pide un código de oRPC sin nombrarlo. La 05 añade `expired` al tipo `NotUndoableReason` de `platform/actions`, junto a `ConflictReason`.
- La huella de `undo` es `undo:<número>`. Nunca coincide con la de una escritura, cuyo nombre de acción siempre lleva un punto.
- El contexto de la entrada original llega al autorizador como `undoes` en `AuthorizationRequest`: número, nombre completo de la acción y actor de esa entrada (`UndoContext`). La petición es la misma en el primer `undo` y en su reintento con la misma clave.
- Deshacer una entrada que no existe responde no encontrado, después de mirar la clave.
- La inversa guardada se vuelve a comprobar contra el contrato actual antes de ejecutarla (`checkInverse`); si ya no vale, error interno y nada cambia.
- `write` y `undo` comparten en `platform/actions` la sección idempotente (`once`) y la ejecución con su entrada (`perform`). `platform/audit` gana `find(número)`, `touchedLater(número)` (otra entrada posterior con el mismo módulo, tipo e id) y `markUndone(número, por)`, que falla si la entrada ya estaba deshecha; `NewEntry` gana `undoes`.
- Sin caducidad todavía: el contenido guardado se da siempre por vigente hasta la 05, también al deshacer.

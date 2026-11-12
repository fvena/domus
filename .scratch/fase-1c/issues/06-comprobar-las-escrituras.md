# 06. Comprobar las escrituras con triggers temporales

Status: ready-for-agent
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

- [ ] **Pruebas de `platform`,** con módulos escritos en la prueba: insertar con otro dueño; cambiar el dueño y restaurarlo; cambiar la clave; crear y borrar en la misma operación; modificaciones múltiples; UPSERT; `REPLACE`; un registro cambiado sin declararlo. Todos revierten el cambio y la entrada.
- [ ] La captura empieza vacía en cada escritura, también después de una revertida, y los triggers existen antes de la primera acción.
- [ ] **`probe`:** lo público ajeno no se edita en `probe` y sí en `probe.board`; la visibilidad solo la cambia el dueño.
- [ ] Pasan todas las comprobaciones y el build.

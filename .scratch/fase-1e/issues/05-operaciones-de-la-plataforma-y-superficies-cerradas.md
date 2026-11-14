# 05. Las operaciones de la plataforma y las superficies cerradas

Status: ready-for-agent
Blocked by: 03

Spec: [`../spec.md`](../spec.md), secciones «La puerta» y «Autorización vía Kira». ADR 0030.

## Qué construir

Kira lee y deshace lo de una persona dentro de su delegación, y nada más de la plataforma: todo lo demás, también lo que se añada mañana, rechaza un mandato. Kira nunca confirma.

- **La función pura** en `platform/authorization` con la lista de operaciones de la plataforma que admiten un mandato: `log/read` y `log/undo`. Lo que no está en ella, también una operación desconocida, no lo admite.
- **La puerta** aplica esa lista a las operaciones de la plataforma. Las rutas de Hono y las de Better Auth siguen cerrando cualquier petición con llave.

## Criterios de aceptación

- [ ] La función pura admite `log/read` y `log/undo`, y rechaza cada una de las demás operaciones de la plataforma y un nombre desconocido.
- [ ] Vía Kira, `log/read` devuelve solo las anotaciones de la persona, dentro de su delegación vigente.
- [ ] Vía Kira, `log/undo` deshace una escritura de la persona dentro de su delegación vigente. Tras retirar la delegación del área, el mismo deshacer se deniega aunque la escritura fuera de antes.
- [ ] `confirmations/confirm` con llave y mandato se rechaza, y la pendiente sigue sin consumir y se puede confirmar después por `app`. Igual con `/reject`.
- [ ] Con llave y mandato se rechazan `delegation/read`, la contraseña, las sesiones, `proofs/request`, `permissions/set`, `delegation/set`, `devices/revoke`, cada operación de las tareas y el aviso de prueba.
- [ ] Con llave y mandato se rechazan subir y descargar archivos, el canal en directo, la clave VAPID, las suscripciones y las rutas de Better Auth.
- [ ] `pnpm check` pasa.

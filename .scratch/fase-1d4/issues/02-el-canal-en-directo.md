# 02. El canal en directo con las invalidaciones de las tablas con dueño

Status: ready-for-agent
Blocked by: 01

Spec: [`../spec.md`](../spec.md), secciones «Dónde vive», «Lo que la escritura recuerda», «El reparto de invalidaciones» (salvo `reset`, que es la 08) y «El canal». Costura 1 y costura 5 de «Decisiones de prueba». ADR 0029.

## Qué construir

Paco y Rocío tienen la app abierta. Rocío añade una nota pública y a los dos les llega en el acto que ha cambiado. Si la nota es privada, solo le llega a ella.

- **`platform/events`**: el registro de canales abiertos por sesión y el reparto tras confirmar. Una regla de dependencias deja fuera a los módulos y a `module-sdk`, con su prueba de arquitectura.
- **Lo que la escritura recuerda**: el primer «antes» y el último «después» de cada registro capturado, con su área, tomados de la captura antes de vaciarla. Si la escritura se revierte, se descarta. Deshacer recorre el mismo camino.
- **La decisión**: una función pura de `platform/authorization` dice si un registro llega a un canal, con los permisos vigentes de su cuenta y el antes y el después del registro.
- **`GET /api/events`**: una ruta de Hono con `streamSSE`, solo con sesión. `ready` cuando el canal ya está registrado, `invalidate` con `{ records }`, el orden de confirmación, un latido cada 25 s con el temporizador de la plataforma que comprueba que la sesión vive (si no, `purge` y cierre), 6 canales por sesión y un tope de 100 eventos en cola.
- **`test-utils`**: un analizador de SSE sobre el `ReadableStream` de la respuesta que no depende de cómo se partan los bytes, y una opción para bajar el tope de la cola.

## Criterios de aceptación

- [ ] Dos personas en sesiones distintas, con el canal abierto: una nota pública nueva llega a las dos; una privada solo a su dueño, y la otra no recibe nada.
- [ ] Pasar una nota de pública a privada llega al lector anterior. Pasarla de privada a pública llega al nuevo lector.
- [ ] Una nota que pasa a pública y vuelve a privada en la misma escritura no llega a la otra persona.
- [ ] Una escritura que se revierte no invalida nada.
- [ ] Deshacer una escritura invalida los registros que vuelven a cambiar, a quien los veía o los ve.
- [ ] Una sesión sin `read` en el área no recibe nada de ella, y la cuenta `device` recibe lo público de las áreas que puede ver.
- [ ] Cada canal recibe un solo `invalidate` por escritura, sin registros repetidos y con la forma `{ module, type, id }`.
- [ ] `ready` llega antes que cualquier invalidación, y una escritura confirmada después de `ready` siempre llega.
- [ ] Los eventos llegan en el orden en que se confirmaron sus escrituras.
- [ ] Abrir el séptimo canal de una sesión cierra el más antiguo, sin `purge`.
- [ ] Una prueba que deja de leer llega al tope de la cola, comprueba por la puerta que el canal se cierra y que la cola no sigue creciendo.
- [ ] El latido sale cada 25 s del reloj de pruebas. Si la sesión ha caducado, escribe `purge` y cierra.
- [ ] Sin sesión, `GET /api/events` responde `401` en JSON, sin el sobre RPC.
- [ ] La función pura de la decisión tiene sus propias pruebas: con y sin `read`, antes y después, dueño o público, creado y borrado.
- [ ] La regla de dependencias de `events` salta en su prueba de arquitectura.
- [ ] `pnpm check` pasa.

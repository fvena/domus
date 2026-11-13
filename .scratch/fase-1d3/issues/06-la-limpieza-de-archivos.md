# 06. La limpieza de archivos

Status: ready-for-agent
Blocked by: 03, 04

Spec: [`../spec.md`](../spec.md), sección «Limpieza» y costura 2 de «Decisiones de prueba». ADR 0028.

## Qué construir

Que la limpieza de cada noche recoja lo que ya nada protege, sin poder borrar un contenido que algo acaba de vincular ni cortar una descarga ya empezada.

- **Pasos nuevos de `cleanup`**, en lotes con su propia transacción: archivos preparados caducados, consumidos o de sesiones que ya no existen; referencias soltadas cuya entrada caducó o ya no se puede deshacer; contenidos sin protección; contenidos reclamados de una pasada cortada, aunque su fichero ya no exista; y temporales de `incoming/` que no estén en una reserva viva.
- **Borrar un contenido**: con el cerrojo de su hash, una transacción comprueba que nada lo protege y lo marca reclamado; después se borra el fichero y se sincroniza su carpeta; por último se borra su fila. «Presente» es disponible y no reclamado, y `attach`, `reattach` y crear un archivo preparado lo comprueban en su transacción.
- **Puntos de intercalación**, solo en la entrada de pruebas: en la limpieza, entre marcar reclamado y borrar el fichero; en la descarga, con el descriptor abierto y antes de transmitir.

## Criterios de aceptación

- [ ] Con `background.runDue()`, la limpieza borra el contenido de un archivo preparado caducado y nunca usado, y el de una referencia soltada cuya entrada caducó.
- [ ] No borra un contenido con una referencia viva, una soltada aún deshacible o un archivo preparado vigente.
- [ ] Un temporal de una subida en curso sobrevive a la limpieza; uno abandonado no.
- [ ] La carrera con `attach`, `reattach` y crear un archivo preparado, en sus dos órdenes: o la escritura gana y el contenido sigue, o la limpieza gana y la escritura falla sin vincular nada a un contenido que se borra.
- [ ] Con el descriptor de una descarga abierto, soltar la referencia y limpiar borran el fichero, y la descarga termina con el hash correcto.
- [ ] Una subida de un hash reclamado responde `CONTENT_BUSY` con `Retry-After: 1` y no deja temporal.
- [ ] Un contenido reclamado que ya perdió su fichero lo retoma la siguiente limpieza y elimina su fila.
- [ ] Limpiar dos veces no cambia nada.
- [ ] `pnpm check` pasa.

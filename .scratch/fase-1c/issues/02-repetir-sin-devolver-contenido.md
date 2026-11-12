# 02. Repetir sin devolver contenido

Status: ready-for-agent
Blocked by: 01

Spec: [`../spec.md`](../spec.md), sección «Resultados, registro y deshacer». ADR 0023, que precisa el ADR 0022.

## Qué construir

Una escritura deja de guardar su resultado: el contenido de la entrada pasa a ser la entrada y la inversa, y una migración generada de la plataforma retira la columna del resultado. Las respuestas quedan fijadas para escrituras y para deshacer:

- **La primera ejecución** devuelve el resultado y el número de la entrada.
- **Repetir** la misma clave con la misma huella vuelve a autorizar y devuelve el acuse `{ entry, repeated: true }`, sin contenido y sin ejecutar. Es el mismo acuse si el contenido caducó o si la entrada se deshizo después: «resultado caducado» deja de ser la respuesta a una repetición. La anotación conserva lo necesario para dar el acuse.
- **Con otra huella**, la respuesta sigue siendo `key-reused`.

La entrada y la inversa mantienen su caducidad, y un deshacer de una entrada caducada sigue respondiendo `expired`.

## Aceptación

- [ ] Las pruebas de la 1b que comprobaban la devolución del resultado guardado se reescriben con el acuse, sin borrarlas: escritura y deshacer, contenido vigente y caducado, y tras reiniciar sobre fichero.
- [ ] Repetir una escritura deshecha devuelve el acuse y no ejecuta.
- [ ] `log()` ya no muestra ningún resultado, y la columna no existe tras migrar una base de la 1b.
- [ ] Pasan todas las comprobaciones, y la generación no deja cambios.

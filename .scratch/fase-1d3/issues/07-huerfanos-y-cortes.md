# 07. Huérfanos y cortes al publicar y al borrar

Status: ready-for-agent
Blocked by: 06

Spec: [`../spec.md`](../spec.md), secciones «Publicar sin perder bytes» y «Limpieza» (los ficheros definitivos sin fila), y costuras 2 y 4 de «Decisiones de prueba». ADR 0028.

## Qué construir

Que un corte de luz a mitad de publicar o de borrar nunca deje un contenido presente sin su fichero, y que lo que deje a medias lo recoja la limpieza.

- **Huérfanos**: la limpieza borra, con el cerrojo de su hash, los ficheros definitivos sin fila con más de una hora. Publicar reutiliza un huérfano con ese hash en vez de escribir otro. Las dos cosas se excluyen.
- **Cortes**: variantes nuevas de `ChildTask` de `startChild` que matan el proceso al publicar (tras el renombrado y antes de las filas) y al borrar (tras marcar reclamado y tras borrar el fichero).

## Criterios de aceptación

- [ ] Un fichero definitivo sin fila de más de una hora se borra; uno de menos, no.
- [ ] Con el punto de intercalación de la publicación, una subida que reutiliza un huérfano y la limpieza que lo recoge no se pisan: o queda publicado con su fila, o la subida escribe el suyo después.
- [ ] Muerto el proceso tras el renombrado, al reabrir no hay contenido presente sin fichero, el huérfano queda y lo recoge la limpieza o lo reutiliza una subida.
- [ ] Muerto tras marcar reclamado y tras borrar el fichero, al reabrir el contenido sigue reclamado y la limpieza termina el borrado y elimina su fila.
- [ ] En ningún punto de corte queda un contenido presente sin su fichero.
- [ ] `pnpm check` pasa.

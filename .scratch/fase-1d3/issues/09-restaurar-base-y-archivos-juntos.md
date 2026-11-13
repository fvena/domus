# 09. Restaurar base y archivos juntos

Status: ready-for-agent
Blocked by: 07, 08

Spec: [`../spec.md`](../spec.md), sección «Restaurar» y costuras 3 y 4 de «Decisiones de prueba». ADR 0028 y ADR 0026.

## Qué construir

Que restaurar devuelva la base y sus contenidos de archivo juntos y comprobados, y que un corte en cualquier punto deje la base anterior entera o la restaurada con todos sus archivos.

- **Antes de tocar nada**: restic deja base y contenidos en la preparación de restaurar; se comprueba el SHA-256 de cada contenido que la base necesita, y si falta uno o no coincide, la restauración se niega. Al sanear, además de lo de la 1d2, se borran los archivos preparados, las referencias soltadas ya caducadas y las filas de contenidos que el conjunto ya no necesita.
- **Instalar**: todos los contenidos necesarios pasan al almacén vivo con un renombrado que sobrescribe, sincronizados, antes de publicar la marca e intercambiar la base. Nunca se borra un contenido vivo.
- **Cortes**: variantes de `ChildTask` tras instalar parte de los contenidos, tras instalarlos todos y antes de la marca, y la retoma desde la marca.

## Criterios de aceptación

- [ ] Restaurar devuelve base y contenidos: las descargas coinciden por hash y deshacer un borrado aún deshacible en la copia recupera su archivo.
- [ ] Un contenido vivo dañado con el hash de uno necesario queda arreglado.
- [ ] Un contenido necesario ausente o dañado en la copia niega la restauración sin tocar la base ni el almacén.
- [ ] Los archivos preparados de la copia no sirven después de restaurar.
- [ ] Muerto el proceso tras instalar parte o todos los contenidos y antes de la marca, la base anterior sigue entera y volver a restaurar termina bien; lo instalado de más lo recoge la limpieza.
- [ ] Retomar desde la marca da los contenidos por instalados y deja la restaurada con todos sus archivos.
- [ ] Los puntos de corte del intercambio de la base de la 1d2 siguen pasando.
- [ ] La preparación de restaurar queda vacía tras éxito, error y cancelación.
- [ ] `pnpm check` pasa.

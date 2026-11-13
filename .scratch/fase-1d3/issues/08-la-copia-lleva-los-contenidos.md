# 08. La copia lleva los contenidos

Status: resolved
Blocked by: 04

Spec: [`../spec.md`](../spec.md), sección «Copia» y costura 3 de «Decisiones de prueba». ADR 0028 y ADR 0026.

## Qué construir

Que la copia de cada noche suba, en la misma instantánea de restic que la base, los contenidos de archivo que esa base necesita, y ninguno más.

- **La lista**: tras la instantánea y su `quick_check`, el mismo proceso hijo saca de la instantánea los contenidos de las referencias vivas y de las soltadas cuya entrada seguía deshacible en el instante de captura. Sin archivos preparados.
- **Los enlaces**: cada contenido de la lista se enlaza con un enlace duro en la preparación, bajo `files/`. Si falta uno, la copia falla sin reintento, con su motivo, y no se guarda como buena.
- **restic** sube `domus.db` y los enlaces con `--files-from-verbatim`. La preparación, enlaces incluidos, se vacía tras éxito, error, cancelación y caída.

## Criterios de aceptación

- [x] Con restic real, la instantánea tiene `domus.db` y los contenidos de una referencia viva y de una soltada aún deshacible, con rutas que no dependen de la carpeta de datos.
- [x] No tiene el contenido de un archivo preparado ni el de una referencia soltada ya caducada en la captura, aunque caduque mientras restic trabaja.
- [x] Un contenido necesario que falta en disco hace fallar la copia sin reintento, sin marca de copia guardada y con `/health` como en una copia fallida.
- [x] La preparación queda vacía, sin enlaces, tras una copia buena, una fallida y una cancelada.
- [x] Las pruebas de la copia de la 1d2 siguen pasando.
- [x] `pnpm check` pasa.

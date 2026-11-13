# 10. La Pi y el cierre de la 1d3

Status: ready-for-agent
Blocked by: 01, 02, 03, 04, 05, 06, 07, 08, 09

Spec: [`../spec.md`](../spec.md), secciones «El ensayo y la comprobación en la Pi» y «Reglas y documentación», y «En la Pi» de «Decisiones de prueba». Plan, 1d3.

## Qué construir

La comprobación en la Pi y el cierre de la 1d3. Las órdenes que tiene que ejecutar una persona en la Pi se dan una a una, en español, y se anotan sus resultados en `despliegue.md`.

- **La imagen `domus-api:ensayo`**, con una composición explícita de módulos que incluye `probe` sin quitarle su `testOnly`. La lista de producción no cambia y su prueba sigue dejando fuera los módulos `testOnly`. Esta tarea decide cómo se elige la composición al construir.
- **En el Domus real**: una subida se prepara; un tipo no admitido y un exceso de tamaño se rechazan; el archivo preparado sin usar desaparece con la limpieza tras caducar; y la copia de esa noche sale bien.
- **En el ensayo**: se suben archivos, se vinculan a notas y una se borra con su deshacer vigente; tras copiar, vaciar solo el volumen de `domus-restore` y restaurar, las descargas coinciden por hash, deshacer recupera el archivo y los archivos preparados de la copia no sirven.
- **Documentación**: `despliegue.md` (el almacén, los límites, el ensayo con archivos y sus resultados), la guía (`docs/guia/`, con sus reglas y el `humanizer`), `packages/AGENTS.md` dentro de su límite, y el plan con la 1d3 hecha.

## Criterios de aceptación

- [ ] La imagen del ensayo incluye `probe` y la de producción no; las dos pruebas de la lista lo comprueban.
- [ ] En el Domus real, las cuatro comprobaciones salen bien y quedan anotadas.
- [ ] En el ensayo, base y archivos se restauran juntos, con los resultados anotados.
- [ ] `despliegue.md`, la guía, `packages/AGENTS.md` y el plan recogen lo construido.
- [ ] `pnpm check` pasa.

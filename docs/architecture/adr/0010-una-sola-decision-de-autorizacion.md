# Una sola decisión de autorización

`platform/authorization` es el único sitio que decide si algo se permite, si pide confirmación y si se puede ver, combinando los permisos de la persona, el filtro de la IA y la visibilidad. Si cada módulo, ruta o tool decidiera por su cuenta, la política acabaría repartida y las respuestas se contradirían; con un solo sitio, cambiarla es cambiar un módulo y probarla es probar uno. Al confirmar, se vuelve a comprobar y se verifica que la operación es exactamente la misma que se propuso. La auditoría guarda las dos identidades: la persona y «vía Kira».

Fecha: 2026-11-11. Preguntas del grilling: P48.
Precisado por el ADR 0023: la decisión es una función pura sobre un contexto verificado que construye la puerta; la confirmación es una pendiente guardada y el step-up, un comprobante de un solo uso.

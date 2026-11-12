# 10. Registro y deshacer con autorización real

Status: ready-for-agent
Blocked by: 02, 06, 07, 08, 09

Spec: [`../spec.md`](../spec.md), sección «Resultados, registro y deshacer». ADR 0023.

## Qué construir

Quién lee el registro y quién deshace, con la autorización completa:

- **Leer el registro** es una lectura de la plataforma. Devuelve solo la anotación de las entradas de la cuenta representada, nunca la entrada ni la inversa. Vía Kira pasa además por la delegación del área `platform`.
- **Deshacer** solo lo pide la misma cuenta representada que hizo la escritura; para cualquier otra, «no encontrado». Vía Kira, dentro de la delegación vigente.
- **La inversa** pasa por la autorización completa (permisos, delegación, confirmación y comprobante cuando correspondan) y por la captura de escrituras.
- **Ambas operaciones** se sirven por HTTP.

## Aceptación

- [ ] El registro devuelve solo anotaciones propias, sin entrada ni inversa. Vía Kira se deniega sin delegación.
- [ ] Deshacer lo ajeno da «no encontrado», y deshacer vía Kira sin delegación se deniega.
- [ ] **Una inversa:**
    - que pide confirmación crea su pendiente y se ejecuta al confirmar;
    - de una acción `manage` exige comprobante;
    - tras perder el permiso, se deniega;
    - sobre un registro que ya no se ve, da «no encontrado»;
    - que rompe una regla de visibilidad revierte.
- [ ] **HTTP:** leer el registro y deshacer funcionan.
- [ ] Pasan todas las comprobaciones y el build.

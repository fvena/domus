# 10. Registro y deshacer con autorización real

Status: resolved
Blocked by: 02, 06, 07, 08, 09

Spec: [`../spec.md`](../spec.md), sección «Resultados, registro y deshacer». ADR 0023.

## Qué construir

Quién lee el registro y quién deshace, con la autorización completa:

- **Leer el registro** es una lectura de la plataforma. Devuelve solo la anotación de las entradas de la cuenta representada, nunca la entrada ni la inversa. Vía Kira pasa además por la delegación del área `platform`.
- **Deshacer** solo lo pide la misma cuenta representada que hizo la escritura; para cualquier otra, «no encontrado». Vía Kira, dentro de la delegación vigente.
- **La inversa** pasa por la autorización completa (permisos, delegación, confirmación y comprobante cuando correspondan) y por la captura de escrituras.
- **Ambas operaciones** se sirven por HTTP.

## Aceptación

- [x] El registro devuelve solo anotaciones propias, sin entrada ni inversa. Vía Kira se deniega sin delegación.
- [x] Deshacer lo ajeno da «no encontrado», y deshacer vía Kira sin delegación se deniega.
- [x] **Una inversa:**
    - que pide confirmación crea su pendiente y se ejecuta al confirmar;
    - de una acción `manage` exige comprobante;
    - tras perder el permiso, se deniega;
    - sobre un registro que ya no se ve, da «no encontrado»;
    - que rompe una regla de visibilidad revierte.
- [x] **HTTP:** leer el registro y deshacer funcionan.
- [x] Pasan todas las comprobaciones y el build.

## Comments

- Hecho en `4ff3b30`.
- Leer el registro es la acción `platform.readLog` (`READ_LOG` en `platform/actions`), una lectura del área `platform` con `subject` la cuenta representada, registrada en el mismo registro de acciones que las operaciones sensibles. Así va por el recorrido entero: vía Kira pasa por la delegación de `platform` `read`, y si esa delegación es `confirm` crea una pendiente de lectura que se confirma como cualquier otra (a diferencia de leer la delegación, que con `confirm` deniega). `RegisteredAction` separa ahora `sensitive` y `subject`, así que una operación de la plataforma puede tener sujeto sin ser sensible.
- La anotación (`logAnnotation` en `@domus/platform/contracts`, `ActionLog.annotationsOf` en `audit`): `entry`, `action`, `actor`, `at`, `undoes`, `undoneBy` y `touched`, en orden de entrada. Deja fuera la entrada, la inversa, la clave, la huella y `expiresAt`. Término nuevo en `GLOSSARY.md`: «Anotación». No hay paginación: devuelve todas las entradas propias; si el registro crece, la 1d o la web pueden añadir `before`/`limit`.
- Deshacer: si la entrada no existe o la escribió otra cuenta representada, `NOT_FOUND` con el mismo mensaje, antes de mirar nada más. Basta la misma cuenta, no el mismo `via`: la app deshace lo que hizo Kira y al revés. Vía Kira, la delegación que cuenta es la del área y nivel de la inversa.
- Punto abierto de la 02: la repetición de un deshacer sigue autorizándose con `input: undefined` cuando caducó el contenido de su propia entrada. No cambia nada, porque `decide` no lee `input`; si algún paso futuro lo leyera, habría que decidir qué hacer con la repetición caducada.
- «Un registro que ya no se ve» solo se puede dar con un cambio fuera del registro (en la prueba, `dbFor`), porque cualquier escritura posterior sobre el mismo registro responde antes `changed-since`. El «no encontrado» es el error declarado del manejador de la inversa (`BOARD_NOTE_NOT_FOUND`). La inversa `manage` y la que rompe una regla de visibilidad se prueban en `platform/actions/undo-authorization.test.ts` con un módulo propio (`ledger`), porque `probe` no tiene una escritura de un área que edite registros de otra ni una acción `manage` deshacible.
- HTTP: `/api/rpc/log/read` y `/api/rpc/log/undo` (`platformContract.log`, con `verifiedSession`); el deshacer lleva la clave en `idempotency-key` y el comprobante en `step-up-proof`, y sin clave responde `BAD_REQUEST`. Un módulo con id `log` se rechaza al arrancar. De paso, `confirmations/confirm` por HTTP pasa ahora el comprobante de la cabecera, que antes no llegaba (una pendiente sensible no se podía confirmar por HTTP); lo prueba `proofs-http.test.ts`.
- `test-utils`: `readLog(contexto)`, la lectura real; `log()` sigue siendo la foto completa solo para pruebas.

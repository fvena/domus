# 07. Delegación

Status: ready-for-agent
Blocked by: 03

Spec: [`../spec.md`](../spec.md), secciones «Delegación» y «La decisión» (paso 2). ADR 0023, ADR 0008.

## Qué construir

La tabla de delegación de cada cuenta y su efecto en la decisión vía Kira:

- **La tabla** guarda `no`, `sí` o `confirmar` por área y nivel, y un valor no arrastra a los demás. Se crea una sola vez, al crear la cuenta: `read` y `write` copian el permiso de ese momento, `manage` empieza en `no` y ninguno empieza en `confirmar`. Después no sigue los cambios de permisos, y un área sin fila vale `no`.
- **La decisión vía Kira** (contexto sintético con `via`) deniega con `no`. El valor `confirmar` lo convierte en confirmación la 08. Hasta entonces, deniega.
- **Leer la delegación** es una lectura de la plataforma: cada persona lee la suya, y el admin, la de la cuenta de aparato. Cambiarla es sensible y llega con la 09.
- **La preparación privilegiada** de las pruebas puede fijar filas de delegación.

## Aceptación

- [ ] **Unitarias de la decisión:** delegación no acumulativa (leer `sí` y escribir `no` en la misma área), `no` vía Kira, un área sin fila, y sin `via` la delegación no se aplica.
- [ ] Una cuenta nueva nace con la delegación copiada y `manage` en `no`. Subirle después un permiso no cambia su delegación.
- [ ] **`probe` vía Kira:** se deniega con `no`, se permite con `sí`, y nunca supera el permiso de la cuenta.
- [ ] Leer la delegación: cada persona la suya, el admin la de la cuenta de aparato, y el admin no puede leer la de otra persona.
- [ ] Pasan todas las comprobaciones, y la generación no deja cambios.

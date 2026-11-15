# 05. La migración

Status: ready-for-agent
Blocked by: 03, 04

Spec: [`../spec.md`](../spec.md), sección «La migración» y costura 2. ADR 0034 y ADR 0021.

## Qué construir

Una sola migración nueva de la plataforma deja la base sin rastro de las apps conectadas, conserva lo que la casa necesita y vale también para restaurar las copias hechas antes de la 1f.

- Fuera del esquema: la tabla de las llaves, la de los mandatos, y las columnas de «solo por `contexto`» y del cierre de su ventana de las confirmaciones. Con ellas desaparecen los restos de compatibilidad que dejó la 04.
- La migración se genera como las demás desde el esquema y lleva además, antes de quitar las columnas, la sentencia que borra las pendientes «solo por `contexto`». El generador no la deduce: se añade a la migración nueva antes de su commit, y dos generaciones seguidas siguen sin dejar cambios.
- Las migraciones anteriores no cambian.
- **La base anterior a la 1f** se prepara dentro de las pruebas, con el ejecutor de migraciones y solo hasta las de la 1e, sin abrir `createTestPlatform`, que aplicaría las actuales.

## Criterios de aceptación

- [ ] Una instalación limpia y una base de la 1e actualizada quedan con el mismo esquema.
- [ ] En esa actualización, una pendiente ordinaria sigue con sus datos y su caducidad, y una «solo por `contexto`» ya no está.
- [ ] Los hashes de las migraciones anteriores no cambian, la base generada nunca se aplica, y dos generaciones seguidas no dejan cambios.
- [ ] Con restic real, una base de la 1e con notas de `probe`, cerrada y copiada en el formato que espera restaurar, se restaura con `restoreBackup` y el código actual: la plataforma se abre, la migración nueva está aplicada y las notas siguen.
- [ ] La plataforma de pruebas no gana ninguna opción para arrancar con migraciones a medias.
- [ ] `pnpm check` pasa, y la CI no deja cambios tras `pnpm db:generate`.

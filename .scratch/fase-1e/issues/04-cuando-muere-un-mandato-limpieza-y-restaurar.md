# 04. Cuándo muere un mandato, la limpieza y restaurar

Status: resolved
Blocked by: 03

Spec: [`../spec.md`](../spec.md), secciones «Mandatos», «Limpieza» y «Restaurar». ADR 0030 y ADR 0026.

## Qué construir

Lo que Kira hace por alguien deja de valer en cuanto termina la sesión de esa persona, y las credenciales no sobreviven a restaurar una copia.

- **La muerte con la sesión**: un mandato resuelve solo mientras vive su sesión, según la regla única de la plataforma. Esa regla ya cubre las cinco formas de terminar una sesión y su caducidad.
- **La limpieza**: un paso nuevo en la diaria que borra, por lotes en su propia transacción, los mandatos caducados y los de una sesión que ya no vive. Nunca cambia una respuesta.
- **Restaurar**: el saneamiento, que trabaja sobre la copia preparada, borra los mandatos y revoca todas las llaves que vienen en ella, con el instante de la restauración. Las llaves creadas después de la copia no existen tras restaurar.

## Criterios de aceptación

- [x] Un mandato que ya se usó con éxito deja de valer en la siguiente petición cuando su sesión termina de cada una de estas formas: cerrar sesión, revocar la sesión, revocar el aparato, cambiar la contraseña desde la app y cambiarla con `pnpm accounts`. También cuando la sesión caduca en el reloj de la plataforma, aunque al mandato le quedaran minutos.
- [x] Un mandato de otra sesión de la misma persona sigue valiendo cuando termina una sesión distinta.
- [x] Tras reiniciar la plataforma sobre el mismo fichero, un mandato vigente sigue valiendo y una llave sigue funcionando.
- [x] La limpieza borra los mandatos caducados y los de sesiones terminadas, deja los vigentes, y ninguna respuesta cambia antes y después de borrar.
- [x] Tras restaurar, ninguna llave anterior a la restauración funciona: ni las que venían vivas en la copia ni las creadas después de ella. `keys list` las muestra revocadas con el instante de restaurar.
- [x] Tras restaurar, ningún mandato anterior vale, y una llave creada después de restaurar funciona con un mandato nuevo.
- [x] `pnpm check` pasa.

## Comments

- Hecho en `e01ea41`.
- La muerte con la sesión no necesitó código: `resolveMandate` ya usaba la regla única. Las pruebas están en `modules/probe/tests/mandate-end.test.ts` (cerrar sesión, revocar la sesión, revocar el aparato, cambiar la contraseña desde la app, la caducidad en el reloj de la plataforma y reabrir sobre fichero), y la de `pnpm accounts` en `platform/identity/command.test.ts`, con un módulo mínimo, porque `runAccounts` no llega a `test-utils`. Revocar el aparato solo vale con un aparato de la cuenta del aparato: la prueba entra con Ana en la pantalla de la cocina.
- La limpieza tiene un paso nuevo en `background/cleanup.ts` para `platform_mandates`: borra los de `expires_at <= now` y los de una sesión que no vive por `sessionLivesWhere`. Sin índices nuevos: la tabla guarda unos minutos de mandatos. Las filas se prueban en `background/cleanup.test.ts`, y las respuestas, iguales antes y después, en `modules/probe/tests/cleanup.test.ts`.
- Restaurar: `sanitizeCopy` llama a `revokeEveryKey` (`identity/keys.ts`), que revoca las llaves vivas con el instante de restaurar (una ya revocada conserva el suyo), y a `endEveryMandate` (`identity/mandates.ts`), en la misma transacción que cierra las sesiones. La prueba, con restic real, está en `modules/probe/tests/restore-keys.test.ts`, con `mandateLife` de un día, porque la copia mueve el reloj a las 05:00 y un mandato de 15 minutos ya habría caducado. Que se borren las filas de los mandatos no se ve desde fuera: con todas las sesiones cerradas, ninguno resuelve de todas formas.
- Está en la spec («Limpieza» y «Restaurar»). `despliegue.md` (crear una llave nueva tras restaurar) queda para la 08.

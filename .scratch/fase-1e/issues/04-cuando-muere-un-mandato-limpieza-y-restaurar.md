# 04. Cuándo muere un mandato, la limpieza y restaurar

Status: ready-for-agent
Blocked by: 03

Spec: [`../spec.md`](../spec.md), secciones «Mandatos», «Limpieza» y «Restaurar». ADR 0030 y ADR 0026.

## Qué construir

Lo que Kira hace por alguien deja de valer en cuanto termina la sesión de esa persona, y las credenciales no sobreviven a restaurar una copia.

- **La muerte con la sesión**: un mandato resuelve solo mientras vive su sesión, según la regla única de la plataforma. Esa regla ya cubre las cinco formas de terminar una sesión y su caducidad.
- **La limpieza**: un paso nuevo en la diaria que borra, por lotes en su propia transacción, los mandatos caducados y los de una sesión que ya no vive. Nunca cambia una respuesta.
- **Restaurar**: el saneamiento, que trabaja sobre la copia preparada, borra los mandatos y revoca todas las llaves que vienen en ella, con el instante de la restauración. Las llaves creadas después de la copia no existen tras restaurar.

## Criterios de aceptación

- [ ] Un mandato que ya se usó con éxito deja de valer en la siguiente petición cuando su sesión termina de cada una de estas formas: cerrar sesión, revocar la sesión, revocar el aparato, cambiar la contraseña desde la app y cambiarla con `pnpm accounts`. También cuando la sesión caduca en el reloj de la plataforma, aunque al mandato le quedaran minutos.
- [ ] Un mandato de otra sesión de la misma persona sigue valiendo cuando termina una sesión distinta.
- [ ] Tras reiniciar la plataforma sobre el mismo fichero, un mandato vigente sigue valiendo y una llave sigue funcionando.
- [ ] La limpieza borra los mandatos caducados y los de sesiones terminadas, deja los vigentes, y ninguna respuesta cambia antes y después de borrar.
- [ ] Tras restaurar, ninguna llave anterior a la restauración funciona: ni las que venían vivas en la copia ni las creadas después de ella. `keys list` las muestra revocadas con el instante de restaurar.
- [ ] Tras restaurar, ningún mandato anterior vale, y una llave creada después de restaurar funciona con un mandato nuevo.
- [ ] `pnpm check` pasa.

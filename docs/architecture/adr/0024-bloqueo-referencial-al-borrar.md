# Bloqueo referencial al borrar

Precisa el ADR 0023: cuándo un borrado puede decir que lo impiden registros que quien lo pide no ve.

**La excepción.** Un borrado puede responder que hay registros dependientes que lo impiden, aunque alguno quede oculto para quien lo pide, solo cuando esa persona ya ve el registro padre y puede borrarlo. Si no lo ve, la respuesta es «no encontrado». Si lo ve pero no puede borrarlo, la respuesta es «no permitido», la misma que daría sin dependientes. La respuesta del bloqueo no revela nada más: ni cuántos hay, ni sus ids, ni sus dueños, ni su visibilidad, ni su contenido. Sin esta excepción, borrar una nota pública propia con un comentario privado ajeno rompería la clave ajena o borraría un registro que no es suyo.

**Solo para la integridad.** La comprobación sin el predicado de visibilidad sirve únicamente para mantener la integridad referencial, y va después de comprobar que se puede borrar. Las lecturas, las búsquedas y los conteos siguen llevando `visible()`. Los registros dependientes siguen protegidos por la captura de escrituras: no hay borrado en cascada de filas ajenas.

**Quién puede borrar.** El manejador no decide el permiso. El contexto le da `editable(table)`, el predicado de los registros que la cuenta puede editar o borrar, construido en `platform/authorization` con la misma regla que comprueba la captura, y `forbidden()`, la respuesta «no permitido» de la plataforma.

**Caso a caso.** Hoy solo la usa `probe.deleteNote`. Un módulo que quiera esta excepción la justifica en su propio grilling.

Fecha: 2026-11-12. Preguntas del grilling: revisión de la fase 1c, borrar una nota pública con un comentario privado ajeno.

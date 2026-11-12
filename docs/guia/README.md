# Guía de Domus

Domus es el organizador privado de una familia de dos adultos que vive en España. Funciona en un ordenador pequeño que tenemos en casa, una Raspberry Pi, y lleva dentro a Kira, una asistente a la que se le puede hablar o escribir. No es un producto para otras casas: lo usamos solo nosotros.

Esta guía explica lo que ya está construido y cómo funciona, sin dar por hecho que sabes programar. Al final de cada tema hay un apartado, «En el código», con los ficheros y comandos para quien los necesite. Si no es tu caso, sáltatelo.

## Qué hay hoy

Lo construido hasta hoy es la base de Domus. Tres programas arrancan en la Pi y comprueban que se entienden entre ellos, la base de datos se pone al día sola cada vez que Domus arranca, y hay una forma fija de añadir partes nuevas de la vida de casa, que llamamos módulos. Un módulo solo lee y cambia sus datos con acciones, que pasan todas por el mismo camino; cada cambio en los datos queda anotado y se puede deshacer si el módulo lo permite. Para pedirle algo a Domus hay que entrar con una cuenta, y una sola pieza decide qué puede hacer cada persona, qué puede hacer Kira en su nombre y quién ve cada cosa. Las cuentas se crean con un comando en la Pi. Domus también trabaja solo: cada noche limpia lo que ya caducó, a la hora de la casa, y avisa en su página de salud si algo se atasca. Y cada cambio en el código pasa unas comprobaciones automáticas antes de entrar.

## Temas

- [Arquitectura](arquitectura.md): las piezas de Domus, cómo se reparten el trabajo y qué hay en cada carpeta.
- [Los programas y cómo hablan](programas.md): los tres programas, la web y cómo saben si pueden contar con los demás.
- [Los datos](datos.md): dónde se guarda la información y cómo cambia de forma sin perder nada.
- [Los módulos](modulos.md): qué es un módulo y qué reglas sigue.
- [Las acciones](acciones.md): cómo se leen y se cambian los datos, y cómo se deshace un cambio.
- [Las cuentas y las sesiones](cuentas.md): cómo entra cada persona y cómo sabe Domus quién pide cada cosa.
- [Los permisos](permisos.md): qué puede hacer cada cuenta y Kira en su nombre, y quién ve cada registro.
- [El trabajo en segundo plano](segundo-plano.md): lo que Domus hace solo, a su hora, como la limpieza de cada noche.
- [Seguridad y privacidad](seguridad.md): quién puede llegar a Domus y cómo se protege lo que guarda.
- [Cómo se construye y se comprueba](como-se-construye.md): cómo trabajamos y qué se revisa en cada cambio.
- [La Pi y el despliegue](la-pi.md): cómo corre Domus en casa y cómo le llegan los cambios.

Lo que viene después está en el [plan por fases](../plan.md), y las palabras propias del proyecto, en el [glosario](../../GLOSSARY.md).

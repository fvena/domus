# Seguridad y privacidad

## Qué es

Lo que hace que a Domus solo llegue la familia y que lo que guarda se quede en casa.

## Cómo funciona

Domus no está abierto a internet. Se llega desde la red de casa o por Tailscale, una red privada que une nuestros aparatos aunque estemos fuera.

Llegar a la Pi no basta. Salvo para decir quién es y qué versión habla, la puerta solo atiende a quien ha entrado con su cuenta, y cada operación pasa por los permisos de esa cuenta. Cómo se entra está en [Las cuentas y las sesiones](cuentas.md), y quién puede hacer qué, en [Los permisos](permisos.md).

El navegador no guarda en su caché ninguna respuesta de Domus, así que quien lo use después no encuentra ahí las notas de otro.

Los datos viven en un único fichero dentro de la Pi y solo api lo abre. assistant y voice-gateway no pueden leerlo; si necesitan algo, se lo piden a api.

Cada programa corre con lo mínimo. Los contenedores no tienen permisos de administrador, sus ficheros son de solo lectura y no tienen ninguna capacidad extra del sistema. Alguien que consiguiera entrar en uno tendría muy poco que tocar.

El código está en GitHub, a la vista de cualquiera, pero los secretos no. Antes de guardar cada cambio, y otra vez al subirlo, se busca cualquier contraseña o clave que se haya podido colar. Si aparece una, el cambio se para ahí. La clave con la que Domus firma las sesiones vive solo en la Pi, en un fichero que no está en el repositorio. La contraseña de las copias de seguridad, también; las copias van cifradas con ella, así que sin ella no se pueden leer.

Entre módulos no hay muros. Todos son código de la casa, corren en el mismo programa y usan el mismo fichero. Que uno no toque las tablas de otro lo vigilan las reglas automáticas y la revisión de cada cambio. Solo las pruebas pueden entrar directamente a las tablas de un módulo.

## Por qué es así

Una casa no necesita estar en internet, y cerrar esa puerta quita de en medio casi todos los riesgos. Aun así, estar en la red de casa no dice quién eres: al wifi también se conectan las visitas.

Con un solo programa tocando los datos, sabemos dónde mirar si algo va mal.

Al ser público el repositorio, un secreto que se cuele queda a la vista de todos, así que la única opción razonable es pararlo antes de que salga del ordenador.

Un muro entre módulos tendría sentido si alguno viniera de fuera. Como todos son nuestros, nos basta con reglas que se comprueban solas.

## En el código

- Acceso: `kira.local:3000` en casa y `tailscale serve` hacia el puerto 3000. Los detalles están en [`docs/despliegue.md`](../despliegue.md).
- Contenedores: `docker-compose.yml` (`read_only`, `cap_drop: ALL`, `no-new-privileges`, el volumen montado solo en api) y `docker/Dockerfile` (`USER node`).
- Entrar: Better Auth en `packages/platform/identity`; sin sesión, toda RPC salvo `status` responde `401`. Toda respuesta de `/api/*`, también los errores, lleva `Cache-Control: no-store`.
- Secretos: `DOMUS_AUTH_SECRET` en el `.env` de la Pi, y la contraseña de las copias en un fichero aparte que compose monta como secret ([Las copias de seguridad y restaurar](copias.md)). gitleaks en `.githooks/pre-commit` y en el trabajo «Secret scan» de `.github/workflows/validate-prs.yml`. Los secretos viven fuera del repositorio.
- Entre módulos: las reglas de `.dependency-cruiser.cjs`. El cliente directo de un módulo está en `@domus/platform/testing`, que solo puede importar `test-utils`.
- Decisiones: [ADR 0003](../architecture/adr/0003-procesos-y-contenedores.md), [ADR 0004](../architecture/adr/0004-una-sola-puerta.md), [ADR 0005](../architecture/adr/0005-kira-aislada.md), [ADR 0021](../architecture/adr/0021-datos-de-los-modulos-y-migraciones.md) y [ADR 0023](../architecture/adr/0023-identidad-y-autorizacion.md).

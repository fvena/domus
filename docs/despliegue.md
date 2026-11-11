# Despliegue en la Raspberry Pi

La Pi se llama `kira`: `kira.local` en casa y `kira.taildd967b.ts.net` por Tailscale. Se entra con `ssh kira` (usuario `fvena`, con `sudo` sin contraseña).

| Qué          | Dónde                                                                                                               |
| ------------ | ------------------------------------------------------------------------------------------------------------------- |
| Código       | `/home/fvena/domus`, un clon de `fvena/domus` en la rama `main`                                                     |
| Contenedores | `api`, `assistant` y `voice-gateway`, del proyecto de compose `domus`                                               |
| Datos        | el volumen `domus_domus-data`, montado solo en `api`                                                                |
| Acceso       | `http://kira.local:3000` en casa; `https://kira.taildd967b.ts.net:8443` por Tailscale (`tailscale serve` → `:3000`) |

Las imágenes se construyen en la propia Pi, que es arm64, en unos 30 segundos. Docker arranca con el sistema y los contenedores tienen `restart: unless-stopped`, así que vuelven solos tras un corte de luz.

## Actualizar

```bash
ssh kira 'cd ~/domus && git pull --ff-only && docker compose up -d --build'
```

Se construyen y reinician los tres a la vez. Si `api` cambia de `protocol` y los otros dos no, se quedan en «incompatible» y no hacen nada hasta tener la misma versión (ADR 0020).

## Comprobar

```bash
ssh kira 'cd ~/domus && docker compose ps && docker compose logs --no-color assistant voice-gateway | grep "api at"'
```

- Los tres contenedores salen `healthy`.
- `assistant` y `voice-gateway` dicen «api at http://api:3000: ready». Si dicen «does not speak protocol», las imágenes son de versiones distintas: vuelve a construir.
- `curl -s -X POST localhost:3000/api/rpc/status` en la Pi devuelve `{"json":{"service":"domus","protocol":1}}`.

Aún no hay copias de seguridad ni secretos: llegan con el núcleo (fase 1). Cuando lleguen, este documento dirá dónde viven.

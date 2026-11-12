# Tres programas, cada uno en su contenedor

Además de la web hay tres programas: `api` (la puerta), `assistant` (Kira, la parte que piensa) y `voice-gateway` (satélites, palabra de activación, STT/TTS y quién habla). Cada uno corre en su contenedor Docker y se reinicia por separado, así que un fallo de la voz o del modelo no tumba la casa. Un solo `docker/Dockerfile` construye las tres imágenes (un destino por programa) para amd64 y arm64, y `docker-compose.yml` las arranca. Solo `api` monta el volumen de datos. Consecuencia: la sesión de Claude que usa el Claude Agent SDK tiene que llegar al contenedor `assistant` sin montar datos; se resuelve en la fase 5.

Fecha: 2026-11-11. Preguntas del grilling: P1, P28.
Precisado por el ADR 0025: `api` monta además el repositorio de copias (`/srv/backups/domus`) y recibe la contraseña de restic como secreto de Docker; la cola y las tareas programadas corren dentro de `api`, sin proceso nuevo.

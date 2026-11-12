# syntax=docker/dockerfile:1.7
# Domus: one Dockerfile, one image per program (targets api, assistant, voice-gateway), for amd64 and arm64.
# Debian slim, not Alpine: native modules such as SQLite's must work on the Pi.
ARG NODE_VERSION=22

# The build stage makes only architecture-independent output (bundles and the web app), so it runs once
# on the builder's own platform instead of under emulation for each target.
FROM --platform=$BUILDPLATFORM node:${NODE_VERSION}-trixie-slim AS build
ENV TURBO_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1
# pnpm runs node-gyp for better-sqlite3 when it installs: it finds a prebuilt binary and compiles nothing, but
# node-gyp still needs its toolchain to get that far.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# Corepack installs the pnpm that package.json's packageManager names.
RUN corepack enable
# Dependencies from the lockfile alone, so this layer survives source changes.
RUN pnpm fetch
COPY . .
RUN pnpm install --offline --frozen-lockfile && pnpm build

# better-sqlite3 for the api image, outside its bundle. The package ships prebuilt Node-API binaries for every
# platform, so it is taken from the build stage (the version in the lockfile, the one the bundle was built against)
# with only the binary of the target architecture: no compiler, no emulation, no pnpm in the image.
FROM build AS api-sqlite
ARG TARGETARCH
RUN case "$TARGETARCH" in amd64) arch=x64 ;; arm64) arch=arm64 ;; \
    *) echo "better-sqlite3 has no prebuilt binary for linux/$TARGETARCH" >&2; exit 1 ;; esac \
  && src="$(readlink -f apps/api/node_modules/better-sqlite3)" \
  && out=/out/node_modules/better-sqlite3 \
  && mkdir -p "$out/prebuilds" \
  && cp -r "$src/package.json" "$src/LICENSE" "$src/lib" "$out/" \
  && cp "$src/prebuilds/linux-$arch.node" "$out/prebuilds/"

# What the three programs share: Node, no package manager, an unprivileged user and a health check on /health.
FROM node:${NODE_VERSION}-trixie-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + process.env.PORT + '/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
ENTRYPOINT ["node", "--enable-source-maps", "/app/main.mjs"]

# The door: the API and the built web app. The only program with the data volume and the backups' repository.
FROM runtime AS api
# restic for the backups (ADR 0026), from Debian's packages; the build fails if it does not answer.
RUN apt-get update \
  && apt-get install -y --no-install-recommends restic \
  && rm -rf /var/lib/apt/lists/* \
  && restic version
# In the image the backups are on unless DOMUS_BACKUPS_OFF=1: the repository is the /backups mount and the password
# the compose secret.
ENV PORT=3000 DOMUS_WEB_DIR=/app/web DOMUS_DATA_DIR=/data \
  DOMUS_BACKUP_REPOSITORY=/backups DOMUS_BACKUP_PASSWORD_FILE=/run/secrets/backup-password
COPY --from=build /repo/apps/api/dist/ ./
COPY --from=build /repo/apps/web/dist/ ./web/
COPY --from=api-sqlite /out/node_modules/ ./node_modules/
# Fails the build, not the first start on the Pi, if the binary does not load on this architecture.
RUN node -e "new (require('better-sqlite3'))(':memory:').close()"
# A new named volume takes the owner of its folder from the image: `node` writes in both.
RUN mkdir -p /data /backups && chown node:node /data /backups
USER node
VOLUME /data
EXPOSE 3000

# Kira, the part that thinks. No data volume: it reaches Domus only through the api.
FROM runtime AS assistant
ENV PORT=3100
COPY --from=build /repo/apps/assistant/dist/ ./
USER node
EXPOSE 3100

# Satellites, wake word, speech and who is speaking. Talks only to the api.
FROM runtime AS voice-gateway
ENV PORT=3200
COPY --from=build /repo/apps/voice-gateway/dist/ ./
USER node
EXPOSE 3200

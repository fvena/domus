# syntax=docker/dockerfile:1.7
# Domus: one Dockerfile, one image per program (targets api, assistant, voice-gateway), for amd64 and arm64.
# Debian slim, not Alpine: native modules such as SQLite's must work on the Pi.
ARG NODE_VERSION=22

# The build stage makes only architecture-independent output (bundles and the web app), so it runs once
# on the builder's own platform instead of under emulation for each target.
FROM --platform=$BUILDPLATFORM node:${NODE_VERSION}-trixie-slim AS build
ENV TURBO_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1
# better-sqlite3 compiles from source when it installs (node-gyp, no prebuilt binary).
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

# What the three programs share: Node, no package manager, an unprivileged user and a health check on /health.
FROM node:${NODE_VERSION}-trixie-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + process.env.PORT + '/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
ENTRYPOINT ["node", "--enable-source-maps", "/app/main.mjs"]

# The door: the API and the built web app. The only program with the data volume.
FROM runtime AS api
ENV PORT=3000 DOMUS_WEB_DIR=/app/web DOMUS_DATA_DIR=/data
COPY --from=build /repo/apps/api/dist/ ./
COPY --from=build /repo/apps/web/dist/ ./web/
RUN mkdir -p /data && chown node:node /data
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

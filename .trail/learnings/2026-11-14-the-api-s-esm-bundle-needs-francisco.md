---
title: "The api's ESM bundle needs a real require for CommonJS dependencies"
author: Francisco
date: 2026-11-14
branch: feat/fase-1d4
cost: { minutes: 6, tokens: 25209 }
id: l-5291d358
scope: repo
status: active
src: agent
touches:
  - ".scratch/fase-1d4/issues/04-suscripciones.md"
  - ".scratch/fase-1d4/spec.md"
  - modules/probe/tests/subscriptions.test.ts
  - packages/AGENTS.md
  - packages/platform/notifications/index.ts
  - ".scratch/fase-1d4/issues/02-el-canal-en-directo.md"
  - modules/probe/tests/events.test.ts
  - packages/platform/actions/capture.ts
  - packages/platform/actions/index.ts
  - packages/platform/files/references.ts
---

## Decided
esbuild bundles the api as ESM, and a CommonJS dependency that requires a Node builtin (web-push requires "crypto") then crashes at startup with «Dynamic require of "crypto" is not supported». The build adds a banner that defines `require` with `createRequire(import.meta.url)`, so esbuild's shim uses it.

## Tried and ruled out
Importing it as `createRequire` in the banner: the bundle already imports that name further down, and Node refuses the duplicate import. The banner aliases it (`bannerRequire`).

## Watch out
`pnpm check` never runs the bundle, so only CI's «The containers start healthy» job catches this. Before adding a CommonJS dependency to api, build it and run `node dist/main.mjs`: without configuration it should stop on `DOMUS_DATA_DIR is required`, not on a require.

In the code: apps/api/package.json `build` script, `--banner:js=…`.

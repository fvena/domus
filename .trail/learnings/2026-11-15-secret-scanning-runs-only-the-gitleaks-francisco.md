---
title: "Secret scanning runs only the gitleaks version CI pins, because others have different default rules"
author: Francisco
date: 2026-11-15
branch: feat/fase-1e
cost: { minutes: 4, tokens: 35410 }
id: l-fc6144e5
scope: repo
status: active
src: agent
touches:
  - ".gitleaksignore"
  - packages/platform/identity/keys.test.ts
  - ".scratch/fase-1e/issues/03-kira-llama-a-acciones-con-un-mandato.md"
  - ".scratch/fase-1e/spec.md"
  - docs/architecture/adr/0023-identidad-y-autorizacion.md
  - docs/architecture/adr/0030-llaves-y-mandatos.md
  - modules/probe/tests/mandates-http.test.ts
  - packages/platform/authorization/authorization.test.ts
  - packages/platform/authorization/index.ts
  - tooling/scripts/gitleaks.ts
---

## Decided
The pre-commit hook and the tests' gitleaks helper use the gitleaks on PATH only when `gitleaks version` is the version CI pins; otherwise the pinned Docker image, and with neither the commit is blocked. A test checks that the workflow pins the same image as the hook.

## Tried and ruled out
- Using whatever gitleaks is on PATH: brew installed 8.30.1, whose `generic-api-key` rule no longer flags a high-entropy made-up secret that 8.24.3 in CI does. The commit passed locally and the PR's secret scan failed on it.

## Watch out
CI scans every commit, so a false positive already in the history is fixed only with its fingerprint in `.gitleaksignore`; changing the file is not enough. Made-up secrets in tests are built at run time with low entropy.

In the code: .githooks/pre-commit (GITLEAKS_IMAGE, GITLEAKS_VERSION), tooling/scripts/gitleaks.ts (findGitleaks, pinnedImage), tooling/scripts/gitleaks.test.ts, .gitleaksignore.

---
title: "The permission and identity model of Domus and Kira is written in its ADRs, and Kira never declares whom it acts for"
author: Francisco
date: 2026-11-15
branch: chore/cierre-fase-1e
cost: { minutes: 1, tokens: 3383 }
id: l-67a1142d
scope: repo
status: active
replaces: l-4d638d3a
src: agent
touches:
  - AGENTS.md
  - docs/architecture/README.md
---

## Decided
The model agreed on 2026-11-11 now lives in the ADRs, the source of truth: roles and allow-or-deny permissions per area and level (ADR 0007), the AI delegation table that only narrows a person's permissions, with confirmation per level (ADR 0008), private-or-public visibility (ADR 0009), the one authorization decision (ADR 0010), identity and authorization (ADR 0023), and keys and mandates (ADR 0030). Kira reaches Domus only through the API door with its key; whom it acts for comes from a mandate the door issues from that person's live session.

## Tried and ruled out
- The first sketch of "one key plus an on-behalf-of account" that Kira sends: the key would become a credential to act as anyone inside their delegation, so ADR 0030 replaced it with door-issued mandates.

## Watch out
Read the ADRs before reasoning from this summary; a later ADR may refine them.

In the code: docs/architecture/README.md (the ADR index), ADRs 0007–0010, 0023, 0030.

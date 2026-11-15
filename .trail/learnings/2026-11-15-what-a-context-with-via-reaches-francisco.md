---
title: "What a context with via reaches is decided in authorization, not at the door"
author: Francisco
date: 2026-11-15
branch: feat/fase-1f-01-garantias-via
cost: { minutes: 6, tokens: 29241 }
id: l-6a21dddc
scope: repo
status: active
replaces: l-1834e071
src: agent
touches:
  - packages/platform/authorization/via.ts
  - packages/platform/authorization/index.ts
  - packages/platform/actions/answering.ts
  - packages/platform/http/index.ts
---

## Decided
Since phase 1f ticket 01, decide in packages/platform/authorization/index.ts asks admitsVia (authorization/via.ts) first: with via, of the platform's actions only platform.readLog passes, and an undo passes whole because what is authorized is its inverse. The door keeps no list: every platform procedure calls verify({ mandate: true }). What stays outside the path of the actions (password/change and sessions/list in the door, requestProof, and confirm/reject in reachable of actions/answering.ts) asks asksByItself, which denies any context with via, whatever channel it declares. A step-up proof counts only when a person brings it by the app without via: the request carries confirmedBy, the context that answered the pending confirmation, and answering passes it instead of confirmed: true.

## Tried and ruled out
- Keeping the proof rule on the channel: a synthetic context with via and the channel app made a manage action go through with the person's proof, and after 1f no channel but app exists.
- Counting a proof via an agent whenever confirmed is true: the idempotent repeat path in once() also authorizes with confirmed: true and nobody answered it, so a repeat via the agent never counts a proof, not even a fresh one the person asked for.

## Watch out
A new platform operation is closed to via without touching anything. A write's find runs before authorization, so via an agent a target that does not exist answers NOT_FOUND before the denial (devices/revoke with one's own session).

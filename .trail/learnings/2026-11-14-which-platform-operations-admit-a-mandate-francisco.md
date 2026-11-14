---
title: Which platform operations admit a mandate
author: Francisco
date: 2026-11-14
branch: feat/fase-1e-05-superficies
cost: { minutes: 30, tokens: 153029 }
id: l-1834e071
scope: repo
status: active
src: agent
touches:
  - packages/platform/http/index.ts
---

## Decided
The door decides whether a platform operation takes a mandate in one place: sessionOrMandateContext(call) in packages/platform/http/index.ts asks admitsMandate (authorization/mandates.ts) with the path oRPC gives the handler it routed to, path.join('/'), never the URL the client wrote. Every platform handler passes its whole call ({ context, path, input }) to sessionOrMandateContext, signedIn or platformWrite, so a new operation written with them is closed to mandates until its path enters the list (only log/read and log/undo in 1e).

## Tried and ruled out
Passing { mandate: true } by hand in the log/read and log/undo handlers, as ticket 03 suggested: it works, but then the handler, not the list, decides, and a copied handler could open an operation silently. Deriving the operation from the request URL: a percent-encoded or normalized path could differ from the procedure oRPC actually dispatches.

## Watch out
modules/probe/tests/platform-mandates-http.test.ts walks platformContract: a new platform operation fails it until it is called there with a good key and a good mandate (expecting UNAUTHORIZED) or added to the list. The routes of Hono and Better Auth stay closed by contextOf without mandate and the before hook of ticket 02, not by this list.

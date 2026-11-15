---
title: "Retired credentials refused at the door in each route's own form"
author: Francisco
date: 2026-11-15
branch: feat/fase-1f-03-llaves-y-mandatos
cost: { minutes: 9, tokens: 42361 }
id: l-e693b73f
scope: repo
status: active
src: agent
touches:
  - packages/platform/http/index.ts
---

## Decided
Since phase 1f ticket 03, the door refuses any request to /api with an Authorization header (any value, empty included) or domus-mandate, with UNAUTHORIZED, before the cookie is read. One Hono middleware on /api/* (packages/platform/http/index.ts, retiredHeaderOf) logs which header, never its value, and answers Better Auth's routes with { code, message } and the Hono routes with errorResponse; for /api/rpc/* it calls next() and the RPCHandler's interceptor throws ORPCError(UNAUTHORIZED) from context.retired, so the answer is oRPC's own envelope, also for a procedure that does not exist. Better Auth's before hook that refused a key or a mandate is gone: the middleware covers its routes.

## Tried and ruled out
- Throwing in the Hono route before rpc.handle: the client would get a bare response, not oRPC's error envelope.
- Writing oRPC's error envelope by hand in the middleware: it couples the door to oRPC's wire format; the interceptor (options.interceptors) runs before matching and its errors are encoded by the codec.

## Watch out
Without a cookie, a refused Hono route answers the same as no credential at all (401 UNAUTHORIZED), so only the variant next to a live session's cookie proves the refusal happens before the session is read.

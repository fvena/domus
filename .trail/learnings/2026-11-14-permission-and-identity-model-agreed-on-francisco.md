---
title: Permission and identity model agreed on 2026-11-11 for Kira living inside Domus…
author: Francisco
date: 2026-11-14
id: l-4d638d3a
scope: repo
status: active
touches:
  - AGENTS.md
  - docs/plan.md
---

## Decided
Agreed with the owner on 2026-11-11 (architecture grilling for Kira inside Domus; to be written into AGENTS.md / architecture.md / ADRs at the end of the grilling):

- Roles are only for people: `admin` (Paco), `member` (Rocío), and a shared-device role (Spanish label "Dispositivo"; replaces both "guest" and the earlier "Casa" idea). `supervised` (for children) goes away: no children in the household.
- Permissions are only allow / deny, per area and level (~50, as today's capabilities).
- The AI is not a role: an AI delegation table can only narrow the represented person's permissions, plus a "ask for confirmation" flag per permission. Some actions declare in code that they always confirm (decided case by case); never a double confirmation. "Approve what someone else proposed", auto-approval and apps' suggest mode disappear; Quick add cards are the same confirmation.
- Visibility is only private / public.
- Kira acts as the account the device signed in with; on a shared-device account, a recognized voice makes it act as that member for the conversation; "soy Paco" only counts if the voice matches.
- Kira talks to Domus through its API door like any client (one key + on-behalf-of), never opening the kernel; agent and voice are separate Docker containers; Kira's code moves into the Domus monorepo; memory lives in Domus (private per person, public for the house).
…

## Watch out
treat these as settled when continuing the Domus/Kira design; check repo docs first in case they were later written down or changed. Related: generic-mechanisms-over-special-cases.

_From Claude Code's memory of this repo, last updated Nov 11._

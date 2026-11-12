# Workflow

How a feature goes from idea to merged code in Domus, with the mattpocock skills. Only work that the current phase of `docs/plan.md` admits enters this flow.

## Steps

1. **Grill.** `/grill-with-docs` on the feature. Done when every branch of the design tree is settled: new terms are in `GLOSSARY.md` and lasting decisions in an ADR (`docs/agents/domain.md`).
2. **Choose the route.**
    - Fits one session: `/implement` in the same chat.
    - Needs several: `/to-spec` writes `.scratch/<feature>/spec.md`, then `/to-tickets` writes `.scratch/<feature>/issues/NN-<slug>.md`, each a thin vertical slice with its `Blocked by`. A ticket narrows the spec and adds no requirement the spec lacks.
3. **Build.** `/implement` takes one ticket at a time, with fresh context between tickets; `/implement-spec` hands the unblocked tickets to subagents and gathers them on one integration branch. Both work test-first with `/tdd`; `/implement-spec` hands each subagent [`implementer-brief.md`](implementer-brief.md). A ticket is done when `pnpm check` passes and its file says `Status: resolved` with the commit under `## Comments`. A decision taken after the spec changes the spec in the same commit; the ticket's Comments say why.
4. **Review.** `/code-review` against `main`: Standards and Spec, side by side. Each finding is fixed, or its reason for staying is recorded in the ticket.
5. **Ship.** `/pr` writes the body: summary, before and after evidence, merge danger. The person merges; then switch to `main`, pull and delete the branch.
6. **Close.** After the merge, deploy `main` to the Pi and run its checks yourself over `ssh kira` (`docs/despliegue.md`). Steps that need a password (creating accounts, signing in, a step-up proof) go to the person: in Spanish, one step per message, each command a complete block with what it should print, waiting for their output before the next. A ticket hands the Pi to a person only for those steps or when a check fails. When the subphase's done-criteria hold, update its state in `docs/plan.md` and bring `docs/guia/` up to date (`docs/AGENTS.md`, «The guide»).
7. **Learn.** `/retro` on the session, before its context is lost.

## Context

Keep one conversation from the grilling until the last ticket is done; each ticket must still be buildable from a clean context, so its file carries everything it needs.

`/implement` and `/implement-spec` are user-invoked: an agent cannot call them, nor hand them to a session it starts. When multi-ticket work is ready, ask the person to run `/implement-spec`, or `/implement` once per ticket.

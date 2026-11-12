# Implementer brief

What `/implement-spec` hands each implementer subagent, on top of pointers to the spec, its ticket and any research notes. The orchestrator fills in the integration branch and the ticket number.

- **Start.** Work in your own worktree on `feat/<phase>-NN-<slug>`. First confirm it starts at the tip of the integration branch; if not, `git reset --hard <integration branch>`. Run `pnpm install` once in a fresh worktree. Node 22 comes from `.nvmrc` and pnpm from corepack; if `pnpm` is missing, put Node 22's `bin` first on `PATH` and call `corepack pnpm`.
- **Read first.** The ticket, the spec sections it names, the ADRs in its area, `GLOSSARY.md`, and the `## Comments` of the tickets already resolved: they record seams and gotchas later tickets rely on.
- **Build test-first** with the `tdd` skill. Each behaviour change starts with a failing test.
- **Migrations.** Generate them with `pnpm db:generate`; never edit one by hand, nor one already on the integration branch. When the integration tip you merge at the end brings new generated migrations, drop yours, merge, and regenerate on top (SQL, journal, snapshot and the `migrations.ts` file).
- **Decisions.** A decision you take that the spec does not state goes into the spec in the same commit, and into the ticket's Comments with why.
- **Done.** `pnpm check` passes. The ticket says `Status: resolved`, its boxes are ticked, and a `## Comments` line in Spanish says «Hecho en `<sha>`» plus anything a later ticket must know. Commits are conventional and in English. No push, no PR.
- **Hand back.** Merge the integration tip into your branch, run `pnpm check` again, and report briefly: branch, final commit, and what is left open or was chosen without asking. Do not repeat the ticket back.

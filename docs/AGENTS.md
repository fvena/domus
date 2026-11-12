# docs

Written in Spanish, except `agents/`.

- `guia/`: the guide for people, including readers who do not program. It is updated when a phase or subphase closes. See «The guide» below.
- `agents/`: instructions for the agent skills (issue tracker, triage labels, domain docs). In English, like the `AGENTS.md` files.
- `plan.md`: the plan by phases, the only place it is written: what each includes, when it is done, its state. Update a phase's state there when it changes.
- `despliegue.md`: how the Raspberry Pi runs Domus, and how to update and check it. Keep it in step with what is really on the Pi.
- `architecture/README.md`: the architecture in one document, with the index of ADRs.
- `architecture/adr/NNNN-slug.md`: one decision each, in the shape of the existing ones: a title, one short paragraph with the decision and its reason (a few when the decision has several parts), then the date and the grilling questions it comes from.

A new decision gets a new ADR with the next number and a row in the README index. A changed decision gets a new ADR that says which one it replaces; one that only refines others opens with «Precisa el ADR NNNN…» and each refined ADR gets the line «Precisado por el ADR NNNN…». The README and the ADRs change in the same commit. `tooling/scripts/adr.test.ts` checks the numbering, the index, the closing date and those links.

## The guide

- Only what is built and on `main`, in the present: no plans, nothing about what is missing. A theme is born with its first built piece. What comes next lives in `plan.md`, linked once from the guide's front page.
- `README.md` is the front page (what Domus is, what exists, the index), with no technical detail. `arquitectura.md` holds the pieces, the layers and the folder map. Each theme has four parts: «Qué es», «Cómo funciona», «Por qué es así» and «En el código». Paths, commands, tool names and ADR links go only in «En el código»; the rest fits in a screen and a half.
- It does not repeat the ADRs, the glossary or `despliegue.md`: it explains and links. Use the plain word first; explain a technical term in one sentence the first time it appears in each theme.
- Style: short, direct sentences; concrete examples from the house; no brochure adjectives or filler («es importante destacar»); no bold-headed lists, emojis or decorative dashes; varied rhythm; cut any paragraph that adds nothing. Review each changed document with the `humanizer` skill.

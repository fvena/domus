# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase. Single context: one glossary and one ADR folder.

## Before exploring, read these

- **`GLOSSARY.md`** at the repo root: the shared vocabulary of Domus, with each term's name in code.
- **`docs/architecture/README.md`**: the architecture in one document, with the index of ADRs.
- **`docs/architecture/adr/`**: read the ADRs that touch the area you're about to work in.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## File structure

```
/
├── GLOSSARY.md
└── docs/architecture/
    ├── README.md
    └── adr/
        ├── 0001-domus-con-kira-dentro.md
        └── 0020-composicion-de-la-api-y-comunicacion-entre-procesos.md
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `GLOSSARY.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0010 (one authorization decision), but worth reopening because…_

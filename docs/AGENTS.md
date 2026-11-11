# docs

Written in Spanish, except `agents/`.

- `agents/`: instructions for the agent skills (issue tracker, triage labels, domain docs). In English, like the `AGENTS.md` files.
- `architecture/README.md`: the architecture in one document, with the index of ADRs.
- `architecture/adr/NNNN-slug.md`: one decision each, in the shape of the existing ones: a title, one short paragraph with the decision and its reason (a few when the decision has several parts), then the date and the grilling questions it comes from.

A new decision gets a new ADR with the next number and a row in the README index. A changed decision gets a new ADR that says which one it replaces. The README and the ADRs change in the same commit.

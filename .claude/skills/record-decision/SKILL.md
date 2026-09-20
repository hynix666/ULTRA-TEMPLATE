---
name: record-decision
description: Write an architecture decision record when a change alters structure, a dependency direction, or a tool other code relies on. Use before merging such a change, or when asked why something is built the way it is.
---

# Record a decision

1. Copy `docs/adr/0000-template.md` to the next free number: `docs/adr/NNNN-title-in-the-imperative.md`.
2. Fill it in:
   - **Context** — the forces behind the decision and anything that already went wrong. Facts, not advocacy.
   - **Decision** — stated so that someone reading only this section knows what to do.
   - **Alternatives considered** — each one with the reason it lost.
   - **Consequences** — what becomes easier, and what it costs, stated plainly.
3. Add its row to the table in `docs/adr/README.md`.
4. Changing an accepted decision: write a new ADR that supersedes it, and set the old record's status to `Superseded by` and a link to the new record. Never rewrite the old text; its reasoning is the record.
5. Ship the ADR in the same pull request as the change it explains.

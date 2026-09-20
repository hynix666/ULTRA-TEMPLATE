# ADR-0001: Record architecture decisions

**Status:** Accepted · **Date:** 2026-09-15

## Context

Decisions that shape a codebase — a dependency direction, a tool other code relies on, a trade-off accepted on purpose — outlive anyone's memory of why they were made. Without the reason, the next person either preserves an accident or undoes a deliberate choice.

## Decision

Record each structural decision as a numbered ADR in `docs/adr/`, starting from `0000-template.md`, and review it in the same pull request as the change it explains.

An accepted ADR is not rewritten. When the decision changes, a new ADR supersedes it and the old record's status line points forward; the original text stays.

## Alternatives considered

- **A wiki or an external document** — drifts from the code and is not reviewed with it.
- **Editing a single architecture document in place** — loses the reasoning behind every earlier state, which is exactly what a later reader needs when a decision looks wrong.

## Consequences

- The reasoning behind the structure is versioned with it.
- Writing a page per structural decision costs time. Small, easily reversed choices do not need one.

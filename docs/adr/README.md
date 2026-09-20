# Architecture decision records

Each record captures one decision that shapes this repository: the context that forced it, what was decided, the alternatives rejected, and what it costs. Start a new one from [`0000-template.md`](0000-template.md) with the next free number.

Records are amended, not rewritten. When a decision changes, a new record supersedes the old one and the old one's status points to it, so the reasoning behind every past state stays readable.

| ADR | Decision | Status |
|---|---|---|
| [0001](0001-record-architecture-decisions.md) | Record architecture decisions | Accepted |
| [0002](0002-one-required-check.md) | One required check, shared by CI and local runs | Accepted |
| [0003](0003-pin-third-party-code.md) | Pin third-party code by digest | Accepted |
| [0004](0004-independent-modules.md) | Modules are independent and removable | Accepted |
| [0005](0005-layered-services-with-enforced-boundaries.md) | Layered services with enforced boundaries | Accepted |
| [0006](0006-one-set-of-agent-instructions.md) | One set of agent instructions, pointed at by every assistant | Accepted |
| [0007](0007-mcp-server-as-an-adapter.md) | Expose the domain to assistants through an MCP adapter | Accepted |
| [0008](0008-a-third-language-and-what-a-module-must-prove.md) | A third language, and what any module must prove | Accepted |
| [0009](0009-where-agent-adapters-and-skills-live.md) | Skills stay real files in `.claude/skills/`; every agent adapter is governed | Accepted, amends 0006 |

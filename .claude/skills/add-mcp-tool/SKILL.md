---
name: add-mcp-tool
description: Add or change a tool in services/mcp-server across its domain, application and adapter layers, with tests through a real MCP client. Use when an assistant needs a new capability, input field or failure message from the MCP server.
---

# Add a tool to mcp-server

Work from the inside out and run `npm test` in `services/mcp-server` after each step.

1. **Domain** (`src/domain`) — add the rule as a pure function over plain data, and a `DomainError` code for each way it can refuse. No `node:` imports and no packages, not even the schema library. Write the refusal message so it names what would work: an assistant that is told the legal moves corrects itself, while one handed a bare rejection retries the same call. Test every refusal in `test/domain.test.ts`.
2. **Application** (`src/application`) — add the use case in `task-tools.ts`. If it needs something the `TaskGateway` port does not offer, extend the port in `ports.ts` and implement it in the HTTP adapter. Validate whatever can be validated locally *before* the call, so a bad argument costs no request. Test it against the fake gateway in `test/task-tools.test.ts`.
3. **MCP adapter** (`src/adapters/mcp.ts`) — register the tool with `registerTool`: a description an assistant can choose on without reading the code, and an `inputSchema` built with `z.object({...})` where every field is `.describe()`d. Call the use case inside `attempt`, so a `DomainError` or `GatewayError` returns `isError: true` with its message instead of throwing a protocol error. Keep the result type's optional properties written `| undefined`; `exactOptionalPropertyTypes` is on, and without it the call resolves to the deprecated raw-shape overload and the error is confusing.
4. **Composition root** — only `src/main.ts` builds adapters, and nothing anywhere writes to stdout.
5. **Test through a client** — add cases to `test/mcp.test.ts`, which connects a real `Client` to the server over a linked in-memory transport pair. Assert what `tools/list` advertises as well as what the call returns: a tool with no description or a schema a client cannot read is unusable however well the handler works.
6. **Check** — `npm run verify` runs the import-boundary check, the type-checker and the tests. If the boundary check fails, a layer reached outside its allowlist: move the code, do not widen the allowlist.
7. **Keep the documentation in step** — the tool table in `services/mcp-server/README.md`, and `architecture/model/system.c4` if the change alters who depends on whom.

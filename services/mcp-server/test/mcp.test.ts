/**
 * The server driven the way a client drives it: over a linked in-memory transport pair, through the
 * real protocol, with no process and no socket. A tool that is registered but unreachable — a bad
 * schema, a handler that throws — fails here and not in someone's editor.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { createServer } from "../src/adapters/mcp.ts";
import { GatewayError } from "../src/application/ports.ts";
import type { TaskGateway } from "../src/application/ports.ts";
import { fakeGateway, task } from "./fake-gateway.ts";

interface ToolCall {
  content: { type: string; text?: string }[];
  isError?: boolean;
}

async function connect(t: { after: (fn: () => Promise<void>) => void }, gateway: TaskGateway): Promise<Client> {
  const [clientEnd, serverEnd] = InMemoryTransport.createLinkedPair();
  const server = createServer(gateway);
  const client = new Client({ name: "test-harness", version: "0.0.0" });
  await server.connect(serverEnd);
  await client.connect(clientEnd);
  t.after(async () => {
    await client.close();
    await server.close();
  });
  return client;
}

const said = (result: unknown): string => (result as ToolCall).content.map((part) => part.text ?? "").join("\n");
const failed = (result: unknown): boolean => (result as ToolCall).isError === true;

test("every tool is advertised with a schema a client can read", async (t) => {
  const client = await connect(t, fakeGateway());
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((tool) => tool.name).sort(), ["create_task", "list_tasks", "move_task"]);
  const move = tools.find((tool) => tool.name === "move_task");
  assert.deepEqual(move?.inputSchema.required, ["id", "status"]);
  assert.ok(tools.every((tool) => (tool.description ?? "") !== ""), "a tool with no description cannot be chosen");
});

test("the tools create, list and move a task", async (t) => {
  const gateway = fakeGateway();
  const client = await connect(t, gateway);

  assert.match(said(await client.callTool({ name: "list_tasks", arguments: {} })), /No tasks yet/);

  const created = await client.callTool({ name: "create_task", arguments: { title: "Write the README" } });
  assert.equal(failed(created), false);
  assert.match(said(created), /Created t1 {2}todo .*Write the README/);

  const listed = said(await client.callTool({ name: "list_tasks", arguments: {} }));
  assert.match(listed, /moves from here: in_progress/);

  const moved = await client.callTool({ name: "move_task", arguments: { id: "t1", status: "in_progress" } });
  assert.match(said(moved), /Moved t1 {2}in_progress .*moves from here: todo, done/);
});

test("a broken rule comes back as a tool error the model can read, not a protocol error", async (t) => {
  const client = await connect(t, fakeGateway([task({ id: "t1", status: "todo" })]));

  const illegal = await client.callTool({ name: "move_task", arguments: { id: "t1", status: "done" } });
  assert.equal(failed(illegal), true);
  assert.match(said(illegal), /INVALID_TRANSITION.*legal moves from todo: in_progress/);

  const missing = await client.callTool({ name: "move_task", arguments: { id: "t9", status: "in_progress" } });
  assert.equal(failed(missing), true);
  assert.match(said(missing), /NOT_FOUND/);

  const empty = await client.callTool({ name: "create_task", arguments: { title: "   " } });
  assert.equal(failed(empty), true);
  assert.match(said(empty), /EMPTY_TITLE/);
});

test("input the schema rejects never reaches the handler", async (t) => {
  const client = await connect(t, fakeGateway());
  const wrong = await client.callTool({ name: "move_task", arguments: { id: "t1", status: "archived" } });
  assert.equal(failed(wrong), true);
});

test("an API that cannot answer is reported with what was tried", async (t) => {
  const unreachable: TaskGateway = {
    async list() {
      throw new GatewayError("GET http://localhost:8080/api/tasks failed: no answer within 10000 ms");
    },
    async create() {
      throw new GatewayError("unused");
    },
    async move() {
      throw new GatewayError("unused");
    },
  };
  const client = await connect(t, unreachable);
  const result = await client.callTool({ name: "list_tasks", arguments: {} });
  assert.equal(failed(result), true);
  assert.match(said(result), /no answer within 10000 ms/);
});

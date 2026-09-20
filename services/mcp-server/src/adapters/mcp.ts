/**
 * The inbound adapter: the use cases as MCP tools.
 *
 * It does three things and nothing else — declare each tool's input schema, call a use case, and
 * turn the outcome into content. A failure the caller can act on comes back as `isError: true` with
 * the reason, because a thrown error reaches the model as a protocol error it cannot inspect.
 */
import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { DomainError, MAX_TITLE_LENGTH, nextStatuses, STATUSES } from "../domain/task.ts";
import type { Task } from "../domain/task.ts";
import { GatewayError } from "../application/ports.ts";
import type { TaskGateway } from "../application/ports.ts";
import { createTask, listTasks, moveTask } from "../application/task-tools.ts";

export const SERVER_NAME = "tasks";

// `isError` is written `| undefined` because exactOptionalPropertyTypes is on: without it this
// type is not assignable to what registerTool expects, and the error names the deprecated overload.
type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean | undefined;
};

const text = (body: string): ToolResult => ({ content: [{ type: "text", text: body }] });

const describe = (task: Task): string =>
  `${task.id}  ${task.status.padEnd(11)} ${task.title}  (moves from here: ${nextStatuses(task.status).join(", ") || "none"})`;

/**
 * Both failures a caller can do something about — a rule it broke, or an API that would not answer —
 * are reported as tool errors. Anything else is a bug here and is left to propagate.
 */
async function attempt(run: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof DomainError) return { content: [{ type: "text", text: `${err.code}: ${err.message}` }], isError: true };
    if (err instanceof GatewayError) return { content: [{ type: "text", text: err.message }], isError: true };
    throw err;
  }
}

export function createServer(gateway: TaskGateway): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: "0.1.0" }, { capabilities: { tools: {} } });

  server.registerTool(
    "list_tasks",
    { description: "List every task with its status and the moves that status allows.", inputSchema: z.object({}) },
    async () =>
      attempt(async () => {
        const tasks = await listTasks(gateway);
        return text(tasks.length === 0 ? "No tasks yet." : tasks.map(describe).join("\n"));
      }),
  );

  server.registerTool(
    "create_task",
    {
      description: "Create a task. It starts in the todo status.",
      inputSchema: z.object({ title: z.string().max(MAX_TITLE_LENGTH).describe("What the task is, in a line") }),
    },
    async ({ title }) => attempt(async () => text(`Created ${describe(await createTask(gateway, title))}`)),
  );

  server.registerTool(
    "move_task",
    {
      description: `Move a task to another status. Legal moves: todo → in_progress → done, and in_progress → todo.`,
      inputSchema: z.object({
        id: z.string().describe("The id of the task, as list_tasks reports it"),
        status: z.enum(STATUSES).describe("The status to move it to"),
      }),
    },
    async ({ id, status }) => attempt(async () => text(`Moved ${describe(await moveTask(gateway, id, status))}`)),
  );

  return server;
}

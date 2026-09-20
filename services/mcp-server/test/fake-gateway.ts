import type { Status, Task } from "../src/domain/task.ts";
import { GatewayError } from "../src/application/ports.ts";
import type { TaskGateway } from "../src/application/ports.ts";

/**
 * The port, implemented in memory. The use cases and the MCP layer are tested through this rather
 * than through a server, so a failing test names a rule and not a network.
 */
export function fakeGateway(initial: readonly Task[] = []): TaskGateway & { readonly tasks: Task[] } {
  const tasks: Task[] = [...initial];
  let next = initial.length + 1;
  return {
    tasks,
    async list() {
      return [...tasks];
    },
    async create(title: string) {
      const now = "2026-01-02T03:04:05Z";
      const task: Task = { id: `t${next++}`, title, status: "todo", createdAt: now, updatedAt: now };
      tasks.push(task);
      return task;
    },
    async move(id: string, status: Status) {
      const index = tasks.findIndex((task) => task.id === id);
      if (index === -1) throw new GatewayError(`PATCH /api/tasks/${id}/status returned 404: not found`);
      const moved = { ...(tasks[index] as Task), status, updatedAt: "2026-01-02T04:00:00Z" };
      tasks[index] = moved;
      return moved;
    },
  };
}

export const task = (overrides: Partial<Task> = {}): Task => ({
  id: "t1",
  title: "Write the README",
  status: "todo",
  createdAt: "2026-01-02T03:04:05Z",
  updatedAt: "2026-01-02T03:04:05Z",
  ...overrides,
});

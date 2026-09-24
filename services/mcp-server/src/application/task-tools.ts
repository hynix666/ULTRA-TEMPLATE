/**
 * The use cases behind the tools. They hold everything a second transport would need to repeat —
 * which is the point of keeping them out of the adapter: the MCP layer below turns a call into one
 * of these and a result into content, and nothing more.
 */
import { checkTransition, DomainError, parseStatus, validateTitle } from "../domain/task.ts";
import type { Task } from "../domain/task.ts";
import type { TaskGateway } from "./ports.ts";

export const listTasks = (gateway: TaskGateway): Promise<readonly Task[]> => gateway.list();

export async function getTask(gateway: TaskGateway, id: string): Promise<Task> {
  const task = await gateway.find(id);
  if (task === undefined) throw new DomainError("NOT_FOUND", `no task with id "${id}"; list_tasks names every task`);
  return task;
}

export async function createTask(gateway: TaskGateway, title: string): Promise<Task> {
  return gateway.create(validateTitle(title));
}

/**
 * Moves a task, refusing locally what the API would refuse. A model that is told the legal moves
 * from the current status can correct itself; one that is handed a 409 usually retries the same call.
 */
export async function moveTask(gateway: TaskGateway, id: string, status: unknown): Promise<Task> {
  const target = parseStatus(status);
  const task = await getTask(gateway, id);
  checkTransition(task.status, target);
  return gateway.move(id, target);
}

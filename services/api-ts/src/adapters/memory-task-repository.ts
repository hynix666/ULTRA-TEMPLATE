import type { TaskRepository } from "../application/ports.ts";
import type { Task } from "../domain/task.ts";

/**
 * In-process TaskRepository: the store the service starts with, and the behaviour any other store
 * must match. A Map keeps insertion order, and replacing a key keeps its original position.
 */
export class MemoryTaskRepository implements TaskRepository {
  readonly #tasks = new Map<string, Task>();

  async save(task: Task): Promise<void> {
    this.#tasks.set(task.id, task);
  }

  async get(id: string): Promise<Task | undefined> {
    return this.#tasks.get(id);
  }

  async list(): Promise<readonly Task[]> {
    return [...this.#tasks.values()];
  }
}

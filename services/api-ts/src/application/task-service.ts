import { createTask, DomainError, transition, type Status, type Task } from "../domain/task.ts";
import type { Clock, IdGenerator, TaskRepository } from "./ports.ts";

export interface TaskServiceDeps {
  readonly repository: TaskRepository;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

/** The use cases. Depends on the domain and on ports, never on an adapter: src/main.ts chooses those. */
export class TaskService {
  readonly #deps: TaskServiceDeps;

  constructor(deps: TaskServiceDeps) {
    this.#deps = deps;
  }

  async create(title: string): Promise<Task> {
    const task = createTask(this.#deps.ids.next(), title, this.#deps.clock.now());
    await this.#deps.repository.save(task);
    return task;
  }

  async get(id: string): Promise<Task> {
    const task = await this.#deps.repository.get(id);
    if (task === undefined) throw new DomainError("NOT_FOUND", "task not found");
    return task;
  }

  list(): Promise<readonly Task[]> {
    return this.#deps.repository.list();
  }

  /** Stores nothing when the domain refuses the move. */
  async transition(id: string, next: Status): Promise<Task> {
    const moved = transition(await this.get(id), next, this.#deps.clock.now());
    await this.#deps.repository.save(moved);
    return moved;
  }
}

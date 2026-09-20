import type { Task } from "../domain/task.ts";

/** Storage port. `get` resolves to undefined for a missing task; the service decides what that means. */
export interface TaskRepository {
  save(task: Task): Promise<void>;
  get(id: string): Promise<Task | undefined>;
  list(): Promise<readonly Task[]>;
}

/** The clock is a port: a service that read the wall clock itself could not be tested exactly. */
export interface Clock {
  now(): string;
}

/** So is the id source, for the same reason. */
export interface IdGenerator {
  next(): string;
}

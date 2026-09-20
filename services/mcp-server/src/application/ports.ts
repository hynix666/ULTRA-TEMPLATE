import type { Status, Task } from "../domain/task.ts";

/**
 * The outbound port: what this service needs from the task API, stated as an interface it owns.
 * The HTTP adapter implements it, and the tests implement it with a fake, so every use case below
 * is tested without a server.
 */
export interface TaskGateway {
  list(): Promise<readonly Task[]>;
  create(title: string): Promise<Task>;
  move(id: string, status: Status): Promise<Task>;
}

/** The API could not be reached, or answered with something this service cannot use. */
export class GatewayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GatewayError";
  }
}

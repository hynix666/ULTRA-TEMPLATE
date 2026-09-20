/**
 * The outbound adapter: the task API over HTTP, behind the TaskGateway port.
 *
 * Everything that can go wrong on the wire is turned into a GatewayError carrying what the caller
 * needs to act — the status and a bounded piece of the body. An MCP client is usually a model, and
 * "fetch failed" tells it nothing it can use.
 */
import { parseTask, parseTasks } from "../domain/task.ts";
import type { Status, Task } from "../domain/task.ts";
import { GatewayError } from "../application/ports.ts";
import type { TaskGateway } from "../application/ports.ts";

/** Enough of an error body to identify the problem, short enough not to fill a model's context. */
const MAX_BODY_CHARS = 500;

export interface HttpGatewayOptions {
  readonly baseUrl: string;
  readonly timeoutMs: number;
  /** Injected so tests drive this adapter without a server, and so a proxy can be supplied. */
  readonly fetch?: typeof globalThis.fetch;
}

export function createHttpTaskGateway(options: HttpGatewayOptions): TaskGateway {
  const doFetch = options.fetch ?? globalThis.fetch;
  const url = (path: string) => new URL(path.replace(/^\//, ""), `${options.baseUrl.replace(/\/$/, "")}/`).toString();

  async function request(path: string, init: RequestInit = {}): Promise<unknown> {
    let response: Response;
    try {
      response = await doFetch(url(path), {
        ...init,
        headers: { accept: "application/json", ...(init.body === undefined ? {} : { "content-type": "application/json" }) },
        signal: AbortSignal.timeout(options.timeoutMs),
      });
    } catch (cause) {
      const reason = cause instanceof Error && cause.name === "TimeoutError" ? `no answer within ${options.timeoutMs} ms` : String(cause);
      throw new GatewayError(`${init.method ?? "GET"} ${url(path)} failed: ${reason}`);
    }
    const text = await response.text();
    if (!response.ok) {
      throw new GatewayError(`${init.method ?? "GET"} ${url(path)} returned ${response.status}: ${text.slice(0, MAX_BODY_CHARS)}`);
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new GatewayError(`${url(path)} answered with ${response.status} but the body is not JSON: ${text.slice(0, MAX_BODY_CHARS)}`);
    }
  }

  return {
    async list(): Promise<readonly Task[]> {
      return parseTasks(await request("/api/tasks"));
    },
    async create(title: string): Promise<Task> {
      return parseTask(await request("/api/tasks", { method: "POST", body: JSON.stringify({ title }) }));
    },
    async move(id: string, status: Status): Promise<Task> {
      return parseTask(await request(`/api/tasks/${encodeURIComponent(id)}/status`, { method: "PATCH", body: JSON.stringify({ status }) }));
    },
  };
}

/**
 * Composition root: the only module that reads the environment and chooses concrete adapters. It
 * holds wiring and nothing else.
 */
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { createHandler, type Log } from "./adapters/http.ts";
import { MemoryTaskRepository } from "./adapters/memory-task-repository.ts";
import { TaskService } from "./application/task-service.ts";
import { ConfigError, loadConfig } from "./config.ts";

const log: Log = (entry) => console.log(JSON.stringify({ time: new Date().toISOString(), ...entry }));

let config;
try {
  config = loadConfig(process.env);
} catch (err) {
  if (!(err instanceof ConfigError)) throw err;
  log({ level: "error", msg: "invalid configuration", error: err.message });
  process.exit(2);
}

const service = new TaskService({
  repository: new MemoryTaskRepository(),
  clock: { now: () => new Date().toISOString() },
  ids: { next: () => randomUUID() },
});

const server = createServer(createHandler(service, log));
// Without these a client that sends headers or a body slowly holds a connection open indefinitely.
server.headersTimeout = 5_000;
server.requestTimeout = 15_000;
server.listen(config.port, () => log({ level: "info", msg: "listening", port: config.port }));

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    log({ level: "info", msg: "shutting down", signal });
    server.close(() => process.exit(0));
    server.closeIdleConnections();
    setTimeout(() => process.exit(1), config.shutdownTimeoutMs).unref();
  });
}

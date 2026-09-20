/**
 * The composition root: read configuration, build the adapters, serve them over stdio.
 *
 * Nothing is logged to stdout, ever. On a stdio server stdout IS the protocol channel, and one
 * stray console.log corrupts the stream in a way that reads to the client as a malformed server.
 * Diagnostics go to stderr.
 */
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createHttpTaskGateway } from "./adapters/http-task-gateway.ts";
import { createServer } from "./adapters/mcp.ts";
import { ConfigError, loadConfig } from "./config.ts";

function run(): number {
  let config;
  try {
    config = loadConfig(process.env);
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err;
    console.error(`mcp-server: ${err.message}`);
    return 2;
  }

  const gateway = createHttpTaskGateway({ baseUrl: config.apiBaseUrl, timeoutMs: config.requestTimeoutMs });
  const handle = serveStdio(() => createServer(gateway));
  console.error(`mcp-server: serving tasks from ${config.apiBaseUrl} over stdio`);

  const stop = async () => {
    await handle.close();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  return 0;
}

const code = run();
if (code !== 0) process.exit(code);

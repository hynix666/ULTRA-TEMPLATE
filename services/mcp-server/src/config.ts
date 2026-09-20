/**
 * Configuration, read once at startup and refused rather than defaulted when it cannot be used.
 *
 * A misconfigured MCP server is worse than a stopped one: it speaks the protocol, answers every
 * tool call with a connection error, and the model keeps trying. So a bad value fails the process.
 */
export interface Config {
  readonly apiBaseUrl: string;
  readonly requestTimeoutMs: number;
}

export class ConfigError extends Error {}

const DEFAULT_TIMEOUT_MS = 10_000;

export function loadConfig(env: Readonly<Record<string, string | undefined>>): Config {
  const rawUrl = env["TASK_API_URL"] ?? "http://localhost:8080";
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ConfigError(`TASK_API_URL must be an absolute URL, got "${rawUrl}"`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ConfigError(`TASK_API_URL must be http or https, got "${url.protocol.replace(":", "")}"`);
  }

  const rawTimeout = env["TASK_API_TIMEOUT_MS"] ?? "";
  // Digits only: Number() would also accept "0x1F90", "8e3" and " 10000".
  const timeout = rawTimeout === "" ? DEFAULT_TIMEOUT_MS : /^\d+$/.test(rawTimeout) ? Number(rawTimeout) : Number.NaN;
  if (!Number.isInteger(timeout) || timeout < 1) {
    throw new ConfigError(`TASK_API_TIMEOUT_MS must be a positive whole number of milliseconds, got "${rawTimeout}"`);
  }

  return { apiBaseUrl: url.toString(), requestTimeoutMs: timeout };
}

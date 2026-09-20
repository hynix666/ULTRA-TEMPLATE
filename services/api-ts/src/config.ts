export interface Config {
  readonly port: number;
  readonly shutdownTimeoutMs: number;
}

export class ConfigError extends Error {}

const UNIT_MS: Readonly<Record<string, number>> = {
  h: 3_600_000, m: 60_000, s: 1000, ms: 1, us: 0.001, "µs": 0.001, "μs": 0.001, ns: 0.000_001,
};

// The grammar of Go's time.ParseDuration: an optional sign, then one or more numbers ("1", "1.", ".5",
// "1.5"), each followed by a unit. Longer units come first in the alternation, so "ms" is not read as "m".
const PART = "(\\d+\\.?\\d*|\\.\\d+)(ns|us|µs|μs|ms|h|m|s)";
const DURATION = new RegExp(`^[-+]?(?:${PART})+$`);

/**
 * Go's duration syntax — `10s`, `1m30s`, `.5s`, `500ms`, `250us` — so the value api-go accepts is the
 * value this service accepts. Null when the text is not a duration. Not rounded: a sub-millisecond
 * timeout is still positive, as it is in Go.
 */
export function parseDurationMs(raw: string): number | null {
  if (!DURATION.test(raw)) return null;
  let total = 0;
  for (const [, amount, unit] of raw.matchAll(new RegExp(PART, "g"))) {
    total += Number(amount) * (UNIT_MS[unit ?? ""] ?? Number.NaN);
  }
  return raw.startsWith("-") ? -total : total;
}

/**
 * Reads configuration once, at startup, and refuses values it cannot use rather than falling back
 * silently. Variable names and formats match api-go, so both services deploy the same way.
 */
export function loadConfig(env: Readonly<Record<string, string | undefined>>): Config {
  const rawPort = env["PORT"] ?? "";
  // Digits only, as strconv.Atoi reads them: Number() would also take "0x1F90", "8e3" and " 8080".
  const port = rawPort === "" ? 8080 : /^[+-]?\d+$/.test(rawPort) ? Number(rawPort) : Number.NaN;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigError(`PORT must be an integer from 1 to 65535, got "${rawPort}"`);
  }

  const rawTimeout = env["SHUTDOWN_TIMEOUT"] ?? "";
  const shutdownTimeoutMs = rawTimeout === "" ? 10_000 : parseDurationMs(rawTimeout);
  if (shutdownTimeoutMs === null || !(shutdownTimeoutMs > 0)) {
    throw new ConfigError(`SHUTDOWN_TIMEOUT must be a positive duration such as 10s, 1m30s or 500ms, got "${rawTimeout}"`);
  }

  return { port, shutdownTimeoutMs };
}

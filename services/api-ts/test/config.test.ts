import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigError, loadConfig } from "../src/config.ts";

test("defaults apply when nothing is set", () => {
  assert.deepEqual(loadConfig({}), { port: 8080, shutdownTimeoutMs: 10_000 });
});

test("valid values are read, in the formats api-go accepts", () => {
  assert.deepEqual(loadConfig({ PORT: "9000", SHUTDOWN_TIMEOUT: "3s" }), { port: 9000, shutdownTimeoutMs: 3000 });
  // Each value here was checked against Go's time.ParseDuration, which accepts all of them.
  const timeouts: [string, number][] = [
    ["500ms", 500], ["1m30s", 90_000], ["1.5s", 1500], ["2h", 7_200_000], ["1.s", 1000], [".5s", 500],
    ["+10s", 10_000], ["0.4ms", 0.4], ["10us", 0.01], ["1h2m3.5s", 3_723_500],
  ];
  for (const [raw, ms] of timeouts) assert.equal(loadConfig({ SHUTDOWN_TIMEOUT: raw }).shutdownTimeoutMs, ms, raw);
});

test("values that cannot be used are refused", () => {
  const bad = [
    { PORT: "http" }, { PORT: "0" }, { PORT: "65536" }, { PORT: "80.5" }, { PORT: "0x1F90" }, { PORT: "8e3" }, { PORT: " 8080" },
    { SHUTDOWN_TIMEOUT: "10" }, { SHUTDOWN_TIMEOUT: "0" }, { SHUTDOWN_TIMEOUT: "0s" }, { SHUTDOWN_TIMEOUT: "1d" },
    { SHUTDOWN_TIMEOUT: ".s" }, { SHUTDOWN_TIMEOUT: "1..5s" }, { SHUTDOWN_TIMEOUT: "-1s" }, { SHUTDOWN_TIMEOUT: "10 s" },
  ];
  for (const env of bad) assert.throws(() => loadConfig(env), ConfigError, JSON.stringify(env));
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigError, loadConfig } from "../src/config.ts";

test("the defaults are the ones the README documents", () => {
  assert.deepEqual(loadConfig({}), { apiBaseUrl: "http://localhost:8080/", requestTimeoutMs: 10_000 });
});

test("a URL this service cannot call fails at startup instead of on every tool call", () => {
  assert.equal(loadConfig({ TASK_API_URL: "https://tasks.internal:8443" }).apiBaseUrl, "https://tasks.internal:8443/");
  assert.throws(() => loadConfig({ TASK_API_URL: "localhost:8080" }), ConfigError);
  assert.throws(() => loadConfig({ TASK_API_URL: "file:///etc/passwd" }), /must be http or https/);
});

test("the timeout is whole milliseconds, and nothing that merely looks like a number", () => {
  assert.equal(loadConfig({ TASK_API_TIMEOUT_MS: "250" }).requestTimeoutMs, 250);
  for (const bad of ["0", "-1", "2.5", "8e3", "0x10", " 250", ""]) {
    if (bad === "") continue;
    assert.throws(() => loadConfig({ TASK_API_TIMEOUT_MS: bad }), ConfigError, bad);
  }
  assert.equal(loadConfig({ TASK_API_TIMEOUT_MS: "" }).requestTimeoutMs, 10_000);
});

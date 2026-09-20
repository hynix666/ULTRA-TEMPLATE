/**
 * server.json is what the MCP Registry publishes, and nothing else checks it against the code until a
 * publish fails in CI — or, worse, succeeds and advertises settings the server no longer reads.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { loadConfig } from "../src/config.ts";

const root = new URL("../", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("server.json", root), "utf8")) as {
  name: string;
  version: string;
  description: string;
  packages: { registryType: string; identifier: string; environmentVariables?: { name: string; default?: string }[] }[];
};
const dockerfile = readFileSync(new URL("Dockerfile", root), "utf8");

test("the image label names the same server, or the registry refuses the publish", () => {
  const label = /LABEL io\.modelcontextprotocol\.server\.name="([^"]+)"/.exec(dockerfile)?.[1];
  assert.equal(label, manifest.name);
  // The registry's namespace for a GitHub-authenticated publisher is io.github.<owner>/<name>.
  assert.match(manifest.name, /^io\.github\.[^/]+\/[a-z0-9-]+$/);
});

test("the package is the image this repository builds, tagged with the manifest's version", () => {
  const [pkg] = manifest.packages;
  assert.equal(pkg?.registryType, "oci");
  assert.match(pkg?.identifier ?? "", new RegExp(`^ghcr\\.io/[^/]+/[a-z0-9-]+-mcp-server:${manifest.version.replaceAll(".", "\\.")}$`));
  // The registry's limit; a longer description is rejected at publish time.
  assert.ok(manifest.description.length <= 100, `${manifest.description.length} characters`);
});

test("every advertised variable is one the server reads, with the default it really uses", () => {
  const advertised = manifest.packages[0]?.environmentVariables ?? [];
  const defaults = loadConfig({});
  assert.deepEqual(advertised.map((variable) => variable.name).sort(), ["TASK_API_TIMEOUT_MS", "TASK_API_URL"]);
  assert.equal(new URL(advertised.find((v) => v.name === "TASK_API_URL")?.default ?? "").toString(), defaults.apiBaseUrl);
  assert.equal(Number(advertised.find((v) => v.name === "TASK_API_TIMEOUT_MS")?.default), defaults.requestTimeoutMs);
});

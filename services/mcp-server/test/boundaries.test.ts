import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { checkFile, checkTree } from "../scripts/check-boundaries.mjs";

// Each rule must be seen to fire. A checker proven only on clean code passes just as well when broken.
test("the domain may not import built-ins, packages or other layers", () => {
  assert.equal(checkFile("src/domain/task.ts", 'import { readFileSync } from "node:fs";').length, 1);
  // The SDK and its schema library belong to the adapter that speaks the protocol, not to the rules.
  assert.equal(checkFile("src/domain/task.ts", 'import * as z from "zod/v4";').length, 1);
  assert.equal(checkFile("src/domain/task.ts", 'import type { TaskGateway } from "../application/ports.ts";').length, 1);
  assert.deepEqual(checkFile("src/domain/task.ts", 'import { other } from "./other.ts";'), []);
});

test("the application may not reach adapters, the SDK or the composition root", () => {
  const multiline = 'import {\n  createHttpTaskGateway,\n} from "../adapters/http-task-gateway.ts";';
  assert.equal(checkFile("src/application/task-tools.ts", multiline).length, 1);
  assert.equal(checkFile("src/application/task-tools.ts", 'import { McpServer } from "@modelcontextprotocol/server";').length, 1);
  assert.equal(checkFile("src/application/task-tools.ts", 'const c = await import("../config.ts");').length, 1);
  assert.deepEqual(checkFile("src/application/task-tools.ts", 'import { parseStatus } from "../domain/task.ts";'), []);
});

test("adapters may use built-ins and packages, but not the composition root", () => {
  assert.deepEqual(checkFile("src/adapters/mcp.ts", 'import { McpServer } from "@modelcontextprotocol/server";\nimport x from "node:util";'), []);
  assert.equal(checkFile("src/adapters/mcp.ts", 'export { loadConfig } from "../config.ts";').length, 1);
});

test("a file outside every layer fails, except the composition root", () => {
  assert.equal(checkFile("src/tools/extra.ts", 'import { readFileSync } from "node:fs";').length, 1);
  assert.equal(checkFile("src/helpers.ts", "export const x = 1;").length, 1);
  assert.deepEqual(checkFile("src/main.ts", 'import { serveStdio } from "@modelcontextprotocol/server/stdio";'), []);
});

test("the real source tree has no violations", () => {
  const { files, problems } = checkTree(join(dirname(fileURLToPath(import.meta.url)), ".."));
  assert.ok(files > 0);
  assert.deepEqual(problems, []);
});

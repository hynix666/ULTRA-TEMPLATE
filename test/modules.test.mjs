// The Node version check must be seen to fail, and to pass on what CI would run.
import assert from "node:assert/strict";
import { test } from "node:test";
import { nodeVersionProblem } from "../scripts/modules.mjs";

test("the running Node matches .node-version by major version", () => {
  assert.equal(nodeVersionProblem("24\n", "24.21.0"), null);
  assert.equal(nodeVersionProblem("v24.1.0", "24.21.0"), null);
  assert.equal(nodeVersionProblem("24", "v24.0.0"), null);
});

test("another major is refused, with the fix in the message", () => {
  assert.match(nodeVersionProblem("24", "22.22.2") ?? "", /this is Node 22\.22\.2, but \.node-version pins Node 24, which CI runs\. Switch to Node 24/);
  assert.match(nodeVersionProblem("24", "240.0.0") ?? "", /pins Node 24/);
});

test("a .node-version that names no version is refused rather than read as any", () => {
  assert.match(nodeVersionProblem("lts/*", "24.21.0") ?? "", /names no Node major version/);
  assert.match(nodeVersionProblem("", "24.21.0") ?? "", /names no Node major version/);
});

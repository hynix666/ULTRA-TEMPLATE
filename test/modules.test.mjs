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

test("modules are found by their manifests, below dependencies and the template never", async (t) => {
  const { mkdtempSync, mkdirSync, rmSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { loadModules } = await import("../scripts/modules.mjs");
  const root = mkdtempSync(join(tmpdir(), "modules-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (path, body) => {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), typeof body === "string" ? body : JSON.stringify(body));
  };
  const manifest = (id) => ({ id, toolchain: "node", checks: [{ name: "npm run verify", run: ["npm", "run", "verify"] }] });
  put("services/api/module.json", manifest("api"));
  put("tool/module.json", manifest("tool"));
  put("apps/web/node_modules/pkg/module.json", manifest("dependency"));
  put("template/module.json", manifest("template-only"));
  put("broken/module.json", "{ not json");

  const { modules, problems } = loadModules(root);
  assert.deepEqual(modules.map((m) => `${m.id} ${m.dir}`), ["api services/api", "tool tool"]);
  assert.match(problems.join(), /broken\/module\.json is not valid JSON/);
});

test("a manifest's check says exactly when it may be skipped", async () => {
  const { validateManifest } = await import("../scripts/modules.mjs");
  const base = { id: "m", toolchain: "go" };
  const problems = (check) => validateManifest({ ...base, checks: [check] }, "m/module.json").join();
  assert.equal(problems({ name: "vet", run: ["go", "vet", "./..."] }), "");
  assert.match(problems({ name: "t", run: ["go", "test"], requires: "moonlight" }), /requires must be one of cgo/);
  assert.match(problems({ name: "t", run: ["go", "test"], otherwise: { name: "x", run: ["go", "test"] } }), /otherwise needs `requires`/);
  assert.match(problems({ name: "lint", run: ["golangci-lint", "run"], tool: "staticcheck" }), /tool must name the command the check runs/);
  assert.match(problems({ name: "fmt", run: ["gofmt", "-l", "."], expect: "silence" }), /expect can only be "no-output"/);
});

test("verify runs each module's checks from its manifest, and nothing else", async () => {
  const { execFileSync } = await import("node:child_process");
  const { ROOT, presentModules } = await import("../scripts/modules.mjs");
  const lines = execFileSync(process.execPath, ["scripts/verify.mjs", "--dry-run", "--no-chassis"], { cwd: ROOT, encoding: "utf8" })
    .trim()
    .split("\n")
    .map((line) => line.split("\t"));
  for (const module of presentModules()) {
    const planned = lines.filter(([name]) => name.startsWith(`${module.id}: `));
    const own = planned.filter(([, dir]) => dir === module.dir).map(([, , command]) => command);
    assert.deepEqual(own, module.checks.map((c) => c.run.join(" ")), module.id);
  }
});
